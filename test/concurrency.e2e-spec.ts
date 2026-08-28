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
      (role === Role.Owner ? 'cc-owner' : 'cc-backoffice');
    req.user = { subject, email: `${role}@example.test`, displayName: role, roles: [role] };
    return true;
  }
}

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const asBackoffice = { 'x-test-role': Role.BackofficeEmployee };
let ownerCounter = 0;
const nextOwner = () => ({
  'x-test-role': Role.Owner,
  'x-test-subject': `cc-owner-${++ownerCounter}`,
});

describe('concurrency and idempotency', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let crn: string;

  async function submitRequest(asOwner: Record<string, string>) {
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

  async function submitAndApprove(asOwner: Record<string, string>) {
    const { requestId, meetingId } = await submitRequest(asOwner);
    await request(app.getHttpServer())
      .patch(`/api/v1/backoffice/settlement-requests/${requestId}/fees`)
      .set(asBackoffice)
      .send({ fees: [{ meetingId, amount: 100 }] });
    await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
      .set(asBackoffice)
      .expect(201);
    return { requestId, meetingId };
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
    crn = `CC-${Date.now()}`;
    await dataSource
      .getRepository(Company)
      .save({ crn, name: 'Concurrency Co', settlementRequired: true, eligibilityReason: 'x' });
    await dataSource.getRepository(User).save({
      keycloakSubject: 'cc-backoffice',
      email: 'cc-backoffice@example.test',
      displayName: 'CC Backoffice',
      role: Role.BackofficeEmployee,
      isActive: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('two simultaneous submissions from the same owner: exactly one succeeds', async () => {
    const asOwner = nextOwner();
    const upload = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner)
      .attach('file', pdf, { filename: 'minutes.pdf', contentType: 'application/pdf' });
    const attachmentDocumentId = upload.body.data.documentId;
    const payload = {
      crn,
      meetings: [{ meetingAt: '2020-01-01T10:00:00.000Z', capital: 1000, attachmentDocumentId }],
    };
    const [a, b] = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/settlement-requests').set(asOwner).send(payload),
      request(app.getHttpServer()).post('/api/v1/settlement-requests').set(asOwner).send(payload),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);
    const rejected = [a, b].find((r) => r.status === 400);
    expect(rejected?.body.error.code).toBe('ACTIVE_REQUEST_EXISTS');
  });

  it('two concurrent payments with the same idempotency key return the identical payment (no duplicate)', async () => {
    const asOwner = nextOwner();
    const { requestId } = await submitAndApprove(asOwner);
    const idempotencyKey = `cc-same-key-${requestId}`;
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/settlement-requests/${requestId}/payment`)
        .set(asOwner)
        .send({ idempotencyKey }),
      request(app.getHttpServer())
        .post(`/api/v1/settlement-requests/${requestId}/payment`)
        .set(asOwner)
        .send({ idempotencyKey }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.id).toBe(b.body.data.id);
    const payments = await dataSource.query('SELECT id FROM payments WHERE request_id = ?', [
      requestId,
    ]);
    expect(payments).toHaveLength(1);
  });

  it('two concurrent payments with different idempotency keys on the same request: exactly one succeeds', async () => {
    const asOwner = nextOwner();
    const { requestId } = await submitAndApprove(asOwner);
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/settlement-requests/${requestId}/payment`)
        .set(asOwner)
        .send({ idempotencyKey: `cc-key-a-${requestId}` }),
      request(app.getHttpServer())
        .post(`/api/v1/settlement-requests/${requestId}/payment`)
        .set(asOwner)
        .send({ idempotencyKey: `cc-key-b-${requestId}` }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);
    const payments = await dataSource.query('SELECT id FROM payments WHERE request_id = ?', [
      requestId,
    ]);
    expect(payments).toHaveLength(1);
  });

  it('two concurrent backoffice decisions (approve + reject) on the same request: exactly one succeeds', async () => {
    const asOwner = nextOwner();
    const { requestId, meetingId } = await submitRequest(asOwner);
    await request(app.getHttpServer())
      .patch(`/api/v1/backoffice/settlement-requests/${requestId}/fees`)
      .set(asBackoffice)
      .send({ fees: [{ meetingId, amount: 100 }] });
    const [approve, reject] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
        .set(asBackoffice),
      request(app.getHttpServer())
        .post(`/api/v1/backoffice/settlement-requests/${requestId}/reject`)
        .set(asBackoffice)
        .send({ reason: 'concurrent reject' }),
    ]);
    const statuses = [approve.status, reject.status].sort();
    expect(statuses).toEqual([201, 400]);
    const finalRequest = await dataSource.query(
      'SELECT status FROM settlement_requests WHERE id = ?',
      [requestId],
    );
    expect(['AWAITING_PAYMENT', 'REJECTED']).toContain(finalRequest[0].status);
  });

  it('two concurrent settlement-document uploads for the same meeting: exactly one succeeds', async () => {
    const asOwner = nextOwner();
    const { requestId, meetingId } = await submitAndApprove(asOwner);
    await request(app.getHttpServer())
      .post(`/api/v1/settlement-requests/${requestId}/payment`)
      .set(asOwner)
      .send({ idempotencyKey: `cc-settle-pay-${requestId}` })
      .expect(201);
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/backoffice/meetings/${meetingId}/settlement-document`)
        .set(asBackoffice)
        .attach('file', pdf, { filename: 'settled-a.pdf', contentType: 'application/pdf' }),
      request(app.getHttpServer())
        .post(`/api/v1/backoffice/meetings/${meetingId}/settlement-document`)
        .set(asBackoffice)
        .attach('file', pdf, { filename: 'settled-b.pdf', contentType: 'application/pdf' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);
    const docs = await dataSource.query(
      "SELECT id FROM documents WHERE kind = 'SETTLEMENT_DOCUMENT'",
    );
    expect(docs).toHaveLength(1);
  });
});
