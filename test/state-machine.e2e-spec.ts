import { INestApplication, CanActivate, ExecutionContext, ValidationPipe } from '@nestjs/common';
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { KeycloakAuthGuard } from '../src/auth/keycloak-auth.guard';
import { Company } from '../src/companies/entities/company.entity';
import { Role } from '../src/common/enums/role.enum';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { User } from '../src/users/entities/user.entity';
import { Logger } from 'nestjs-pino';

class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role =
      req.headers['x-test-role'] === Role.BackofficeEmployee ? Role.BackofficeEmployee : Role.Owner;
    const subject =
      (req.headers['x-test-subject'] as string) ??
      (role === Role.Owner ? 'sm-owner' : 'sm-backoffice');
    req.user = { subject, email: `${role}@example.test`, displayName: role, roles: [role] };
    return true;
  }
}

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const asBackoffice = { 'x-test-role': Role.BackofficeEmployee };
// Each test gets its own owner subject so the one-active-request-per-owner
// lock from one test's still-in-progress request can't block the next test.
let ownerCounter = 0;
const nextOwner = () => ({
  'x-test-role': Role.Owner,
  'x-test-subject': `sm-owner-${++ownerCounter}`,
});

describe('state-machine hardening', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let crn: string;

  async function submitRequest(
    asOwner: Record<string, string>,
  ): Promise<{ requestId: string; meetingId: string }> {
    const upload = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner)
      .attach('file', pdf, { filename: 'minutes.pdf', contentType: 'application/pdf' });
    const created = await request(app.getHttpServer())
      .post('/api/v1/settlement-requests')
      .set(asOwner)
      .send({
        crn,
        meetings: [
          {
            meetingAt: '2020-01-01T10:00:00.000Z',
            capital: 1000,
            attachmentDocumentId: upload.body.data.documentId,
          },
        ],
      });
    const requestId = created.body.data.id;
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/backoffice/settlement-requests/${requestId}`)
      .set(asBackoffice);
    return { requestId, meetingId: detail.body.data.meetings[0].id };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KeycloakAuthGuard)
      .useClass(TestAuthGuard)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter(app.get(Logger)));
    await app.init();
    dataSource = app.get(DataSource);
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of [
      'audit_events',
      'notifications',
      'status_history',
      'payments',
      'meeting_fees',
      'meetings',
      'documents',
      'owner_active_request_locks',
      'settlement_requests',
      'companies',
      'users',
    ]) {
      await dataSource.query(`TRUNCATE TABLE ${table}`);
    }
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 1');
    crn = `SM-${Date.now()}`;
    await dataSource
      .getRepository(Company)
      .save({ crn, name: 'State Machine Co', settlementRequired: true, eligibilityReason: 'x' });
    await dataSource.getRepository(User).save({
      keycloakSubject: 'sm-backoffice',
      email: 'sm-backoffice@example.test',
      displayName: 'SM Backoffice',
      role: Role.BackofficeEmployee,
      isActive: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects approval before every meeting has a fee', async () => {
    const { requestId } = await submitRequest(nextOwner());
    const res = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
      .set(asBackoffice);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INCOMPLETE_FEES');
  });

  it('rejects payment before approval (still UNDER_REVIEW)', async () => {
    const asOwner = nextOwner();
    const { requestId } = await submitRequest(asOwner);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/settlement-requests/${requestId}/payment`)
      .set(asOwner)
      .send({ idempotencyKey: `sm-pay-before-approval-${requestId}` });
    expect(res.status).toBe(400);
  });

  it('rejects settlement-document upload before payment (still AWAITING_PAYMENT)', async () => {
    const { requestId, meetingId } = await submitRequest(nextOwner());
    await request(app.getHttpServer())
      .patch(`/api/v1/backoffice/settlement-requests/${requestId}/fees`)
      .set(asBackoffice)
      .send({ fees: [{ meetingId, amount: 100 }] });
    await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
      .set(asBackoffice)
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/meetings/${meetingId}/settlement-document`)
      .set(asBackoffice)
      .attach('file', pdf, { filename: 'settled.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
  });

  it('rejects reject-after-approve (request no longer UNDER_REVIEW)', async () => {
    const { requestId, meetingId } = await submitRequest(nextOwner());
    await request(app.getHttpServer())
      .patch(`/api/v1/backoffice/settlement-requests/${requestId}/fees`)
      .set(asBackoffice)
      .send({ fees: [{ meetingId, amount: 100 }] });
    await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
      .set(asBackoffice)
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/reject`)
      .set(asBackoffice)
      .send({ reason: 'too late' });
    expect(res.status).toBe(400);
  });

  it('a rejected request is final: cannot approve, reject again, set fees, or pay', async () => {
    const asOwner = nextOwner();
    const { requestId, meetingId } = await submitRequest(asOwner);
    await request(app.getHttpServer())
      .patch(`/api/v1/backoffice/settlement-requests/${requestId}/fees`)
      .set(asBackoffice)
      .send({ fees: [{ meetingId, amount: 100 }] });
    await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/reject`)
      .set(asBackoffice)
      .send({ reason: 'insufficient evidence' })
      .expect(201);

    const approve = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
      .set(asBackoffice);
    expect(approve.status).toBe(400);

    const rejectAgain = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/reject`)
      .set(asBackoffice)
      .send({ reason: 'again' });
    expect(rejectAgain.status).toBe(400);

    const fees = await request(app.getHttpServer())
      .patch(`/api/v1/backoffice/settlement-requests/${requestId}/fees`)
      .set(asBackoffice)
      .send({ fees: [{ meetingId, amount: 999 }] });
    expect(fees.status).toBe(400);

    const pay = await request(app.getHttpServer())
      .post(`/api/v1/settlement-requests/${requestId}/payment`)
      .set(asOwner)
      .send({ idempotencyKey: `sm-rejected-pay-${requestId}` });
    expect(pay.status).toBe(400);
  });

  it('a fully settled request is final: cannot re-upload a settlement document or re-approve', async () => {
    const asOwner = nextOwner();
    const { requestId, meetingId } = await submitRequest(asOwner);
    await request(app.getHttpServer())
      .patch(`/api/v1/backoffice/settlement-requests/${requestId}/fees`)
      .set(asBackoffice)
      .send({ fees: [{ meetingId, amount: 100 }] });
    await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
      .set(asBackoffice)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/settlement-requests/${requestId}/payment`)
      .set(asOwner)
      .send({ idempotencyKey: `sm-settle-pay-${requestId}` })
      .expect(201);
    const settle = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/meetings/${meetingId}/settlement-document`)
      .set(asBackoffice)
      .attach('file', pdf, { filename: 'settled.pdf', contentType: 'application/pdf' });
    expect(settle.status).toBe(201);
    expect(settle.body.data.status).toBe('SETTLED');

    const reupload = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/meetings/${meetingId}/settlement-document`)
      .set(asBackoffice)
      .attach('file', pdf, { filename: 'settled-again.pdf', contentType: 'application/pdf' });
    // Blocked because the request is no longer PAID/PARTIALLY_SETTLED (it's
    // SETTLED) — INVALID_STATUS_TRANSITION, not DOCUMENT_ALREADY_ATTACHED. Either
    // rejection reason is correct; what matters is the upload after final settlement.
    expect(reupload.status).toBe(400);

    const reapprove = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
      .set(asBackoffice);
    expect(reapprove.status).toBe(400);
  });

  it('rejects zero-meeting submissions', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/settlement-requests')
      .set(nextOwner())
      .send({ crn, meetings: [] });
    expect(res.status).toBe(400);
  });
});
