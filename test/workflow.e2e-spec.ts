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
    const request = context.switchToHttp().getRequest();
    const role =
      request.headers['x-test-role'] === Role.BackofficeEmployee
        ? Role.BackofficeEmployee
        : Role.Owner;
    request.user = {
      subject: role === Role.Owner ? 'e2e-owner' : 'e2e-backoffice',
      email: `${role}@example.test`,
      displayName: role,
      roles: [role],
    };
    return true;
  }
}

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const auth = (role: Role) => ({ 'x-test-role': role });

describe('settlement workflow (HTTP, MySQL, MinIO, ClamAV)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let crn: string;
  let clearCrn: string;

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
    crn = `E2E-${Date.now()}`;
    clearCrn = `${crn}-CLEAR`;
    await dataSource.getRepository(Company).save({
      crn,
      name: 'E2E Company',
      settlementRequired: true,
      eligibilityReason: 'Historic meetings',
    });
    await dataSource.getRepository(Company).save({
      crn: clearCrn,
      name: 'E2E Clear Company',
      settlementRequired: false,
      eligibilityReason: 'No outdated meetings.',
    });
    await dataSource.getRepository(User).save({
      keycloakSubject: 'e2e-backoffice',
      email: 'backoffice@example.test',
      displayName: 'E2E Backoffice',
      role: Role.BackofficeEmployee,
      isActive: true,
    });
  });

  afterAll(async () => {
    await dataSource?.getRepository(Company).save([
      {
        id: '00000000-0000-4000-8000-000000000001',
        crn: 'CRN-DEMO-001',
        name: 'MCDR Demo Trading Company',
        settlementRequired: true,
        eligibilityReason: 'Outdated General Assembly meetings require settlement.',
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        crn: 'CRN-CLEAR-001',
        name: 'MCDR Clear Company',
        settlementRequired: false,
        eligibilityReason: 'No settlement is currently required.',
      },
    ]);
    await app.close();
  });

  it('completes owner submission, review, payment, and per-meeting settlement', async () => {
    const eligible = await request(app.getHttpServer())
      .get(`/api/v1/companies/${crn}/settlement-eligibility`)
      .set(auth(Role.Owner))
      .expect(200);
    expect(eligible.body.data.settlementRequired).toBe(true);
    const duplicateLookup = await request(app.getHttpServer())
      .get(`/api/v1/companies/${crn}/settlement-eligibility`)
      .set(auth(Role.Owner))
      .expect(200);
    expect(duplicateLookup.body.data).toEqual(eligible.body.data);
    const notEligible = await request(app.getHttpServer())
      .get(`/api/v1/companies/${clearCrn}/settlement-eligibility`)
      .set(auth(Role.Owner))
      .expect(200);
    expect(notEligible.body.data.settlementRequired).toBe(false);

    const upload = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(auth(Role.Owner))
      .attach('file', pdf, { filename: 'minutes.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    const documentId = upload.body.data.documentId;

    const created = await request(app.getHttpServer())
      .post('/api/v1/settlement-requests')
      .set(auth(Role.Owner))
      .send({
        crn,
        meetings: [
          {
            meetingAt: '2020-01-01T10:00:00.000Z',
            capital: 100000,
            attachmentDocumentId: documentId,
          },
        ],
      });
    expect(created.status).toBe(201);
    const requestId = created.body.data.id;

    const queue = await request(app.getHttpServer())
      .get('/api/v1/backoffice/settlement-requests')
      .query({ limit: 1, crn })
      .set(auth(Role.BackofficeEmployee))
      .expect(200);
    expect(queue.body.data.items).toHaveLength(1);
    expect(queue.body.data.items[0].id).toBe(requestId);
    expect(queue.body.data.nextCursor).toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/settlement-requests')
      .set(auth(Role.Owner))
      .send({
        crn,
        meetings: [
          {
            meetingAt: '2020-02-01T10:00:00.000Z',
            capital: 100000,
            attachmentDocumentId: documentId,
          },
        ],
      })
      .expect(400);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/backoffice/settlement-requests/${requestId}`)
      .set(auth(Role.BackofficeEmployee))
      .expect(200);
    const meetingId = detail.body.data.meetings[0].id;

    const feesResponse = await request(app.getHttpServer())
      .patch(`/api/v1/backoffice/settlement-requests/${requestId}/fees`)
      .set(auth(Role.BackofficeEmployee))
      .send({ fees: [{ meetingId, amount: 250 }] });
    expect(feesResponse.status).toBe(200);
    await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
      .set(auth(Role.BackofficeEmployee))
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/settlement-requests/${requestId}/payment-summary`)
      .set(auth(Role.Owner))
      .expect(200);
    const payment = await request(app.getHttpServer())
      .post(`/api/v1/settlement-requests/${requestId}/payment`)
      .set(auth(Role.Owner))
      .send({ idempotencyKey: 'e2e-payment-key' })
      .expect(201);
    expect(payment.body.data.amount).toBe('250.00');

    const settlement = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/meetings/${meetingId}/settlement-document`)
      .set(auth(Role.BackofficeEmployee))
      .attach('file', pdf, { filename: 'settled.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(settlement.body.data.status).toBe('SETTLED');

    await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
      .set(auth(Role.BackofficeEmployee))
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set(auth(Role.Owner))
      .expect(200);

    const secondUpload = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(auth(Role.Owner))
      .attach('file', pdf, { filename: 'second-minutes.pdf', contentType: 'application/pdf' })
      .expect(201);
    const secondDocumentId = secondUpload.body.data.documentId;

    const rejected = await request(app.getHttpServer())
      .post('/api/v1/settlement-requests')
      .set(auth(Role.Owner))
      .send({
        crn,
        meetings: [
          {
            meetingAt: '2020-03-01T10:00:00.000Z',
            capital: 100000,
            attachmentDocumentId: secondDocumentId,
          },
          {
            meetingAt: '2020-04-01T10:00:00.000Z',
            capital: 100000,
            attachmentDocumentId: documentId,
          },
        ],
      })
      .expect(201);
    const rejectedId = rejected.body.data.id;
    const rejectedDetailForFees = await request(app.getHttpServer())
      .get(`/api/v1/backoffice/settlement-requests/${rejectedId}`)
      .set(auth(Role.BackofficeEmployee))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/backoffice/settlement-requests/${rejectedId}/fees`)
      .set(auth(Role.BackofficeEmployee))
      .send({ fees: [{ meetingId: rejectedDetailForFees.body.data.meetings[0].id, amount: 50 }] })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${rejectedId}/approve`)
      .set(auth(Role.BackofficeEmployee))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${rejectedId}/reject`)
      .set(auth(Role.BackofficeEmployee))
      .send({ reason: 'Attachment requires clarification.' })
      .expect(201);
    const rejectedDetail = await request(app.getHttpServer())
      .get(`/api/v1/settlement-requests/${rejectedId}`)
      .set(auth(Role.Owner))
      .expect(200);
    expect(rejectedDetail.body.data.status).toBe('REJECTED');
    await request(app.getHttpServer())
      .post(`/api/v1/settlement-requests/${rejectedId}/payment`)
      .set(auth(Role.Owner))
      .send({ idempotencyKey: 'rejected-payment-key' })
      .expect(400);
  });

  it('rejects wrong roles and hostile uploads before business processing', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/settlement-requests')
      .set(auth(Role.Owner))
      .send({ crn, meetings: [] })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/companies/${crn}/settlement-eligibility`)
      .set(auth(Role.BackofficeEmployee))
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(auth(Role.Owner))
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'evil.html',
        contentType: 'text/html',
      })
      .expect(400);
  });
});
