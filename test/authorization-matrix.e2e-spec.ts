import {
  INestApplication,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
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

// Every protected route accepts x-test-role / x-test-subject headers so this
// suite can impersonate two distinct owners, not just one fixed subject per role.
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const roleHeader = req.headers['x-test-role'];
    // Mirrors KeycloakAuthGuard: no bearer token means 401, not "let it through".
    if (!roleHeader) throw new UnauthorizedException('Bearer token required');
    const role = roleHeader === Role.BackofficeEmployee ? Role.BackofficeEmployee : Role.Owner;
    const subject = (req.headers['x-test-subject'] as string) ?? `e2e-${role}`;
    req.user = { subject, email: `${subject}@example.test`, displayName: subject, roles: [role] };
    return true;
  }
}

const noAuth = {};
const asOwner = (subject = 'owner-a') => ({
  'x-test-role': Role.Owner,
  'x-test-subject': subject,
});
const asBackoffice = { 'x-test-role': Role.BackofficeEmployee, 'x-test-subject': 'backoffice-1' };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');

describe('authorization matrix', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let crn: string;
  let ownerARequestId: string;
  let ownerAMeetingId: string;
  let ownerAAttachmentId: string;

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
    crn = `AUTHZ-${Date.now()}`;
    await dataSource
      .getRepository(Company)
      .save({ crn, name: 'Authz Co', settlementRequired: true, eligibilityReason: 'test' });
    await dataSource.getRepository(User).save({
      keycloakSubject: 'backoffice-1',
      email: 'backoffice-1@example.test',
      displayName: 'Backoffice One',
      role: Role.BackofficeEmployee,
      isActive: true,
    });

    const upload = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner('owner-a'))
      .attach('file', pdf, { filename: 'minutes.pdf', contentType: 'application/pdf' });
    ownerAAttachmentId = upload.body.data.documentId;
    const created = await request(app.getHttpServer())
      .post('/api/v1/settlement-requests')
      .set(asOwner('owner-a'))
      .send({
        crn,
        meetings: [
          {
            meetingAt: '2020-01-01T10:00:00.000Z',
            capital: 1000,
            attachmentDocumentId: ownerAAttachmentId,
          },
        ],
      });
    ownerARequestId = created.body.data.id;
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/backoffice/settlement-requests/${ownerARequestId}`)
      .set(asBackoffice);
    ownerAMeetingId = detail.body.data.meetings[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  type Case = {
    label: string;
    req: (r: request.SuperTest<request.Test>) => request.Test;
    allow: ('owner' | 'backoffice')[];
  };

  const cases: Case[] = [
    {
      label: 'GET /companies/:crn/settlement-eligibility',
      req: (r) => r.get(`/api/v1/companies/${crn}/settlement-eligibility`),
      allow: ['owner'],
    },
    {
      label: 'POST /settlement-requests',
      req: (r) => r.post('/api/v1/settlement-requests').send({ crn, meetings: [] }),
      allow: ['owner'],
    },
    {
      label: 'GET /settlement-requests',
      req: (r) => r.get('/api/v1/settlement-requests'),
      allow: ['owner'],
    },
    {
      label: 'GET /settlement-requests/:id',
      req: (r) => r.get(`/api/v1/settlement-requests/${ownerARequestId}`),
      allow: ['owner'],
    },
    {
      label: 'GET /settlement-requests/:id/payment-summary',
      req: (r) => r.get(`/api/v1/settlement-requests/${ownerARequestId}/payment-summary`),
      allow: ['owner'],
    },
    {
      label: 'POST /settlement-requests/:id/payment',
      req: (r) =>
        r
          .post(`/api/v1/settlement-requests/${ownerARequestId}/payment`)
          .send({ idempotencyKey: 'authz-key' }),
      allow: ['owner'],
    },
    {
      label: 'GET /backoffice/settlement-requests',
      req: (r) => r.get('/api/v1/backoffice/settlement-requests'),
      allow: ['backoffice'],
    },
    {
      label: 'GET /backoffice/settlement-requests/:id',
      req: (r) => r.get(`/api/v1/backoffice/settlement-requests/${ownerARequestId}`),
      allow: ['backoffice'],
    },
    {
      label: 'PATCH /backoffice/settlement-requests/:id/fees',
      req: (r) =>
        r
          .patch(`/api/v1/backoffice/settlement-requests/${ownerARequestId}/fees`)
          .send({ fees: [] }),
      allow: ['backoffice'],
    },
    {
      label: 'POST /backoffice/settlement-requests/:id/approve',
      req: (r) => r.post(`/api/v1/backoffice/settlement-requests/${ownerARequestId}/approve`),
      allow: ['backoffice'],
    },
    {
      label: 'POST /backoffice/settlement-requests/:id/reject',
      req: (r) =>
        r
          .post(`/api/v1/backoffice/settlement-requests/${ownerARequestId}/reject`)
          .send({ reason: 'x' }),
      allow: ['backoffice'],
    },
    {
      label: 'POST /backoffice/meetings/meeting-attachment',
      req: (r) =>
        r
          .post('/api/v1/backoffice/meetings/meeting-attachment')
          .attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' }),
      allow: ['owner'],
    },
    {
      label: 'GET /backoffice/meetings/:id (download)',
      req: (r) => r.get(`/api/v1/backoffice/meetings/${ownerAAttachmentId}`),
      allow: ['owner', 'backoffice'],
    },
    {
      label: 'POST /backoffice/meetings/:id/settlement-document',
      req: (r) =>
        r
          .post(`/api/v1/backoffice/meetings/${ownerAMeetingId}/settlement-document`)
          .attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' }),
      allow: ['backoffice'],
    },
    {
      label: 'GET /notifications',
      req: (r) => r.get('/api/v1/notifications'),
      allow: ['owner', 'backoffice'],
    },
    {
      label: 'GET /notifications/unread-count',
      req: (r) => r.get('/api/v1/notifications/unread-count'),
      allow: ['owner', 'backoffice'],
    },
  ];

  for (const c of cases) {
    it(`${c.label}: rejects an unauthenticated caller with 401`, async () => {
      const res = await c.req(request(app.getHttpServer()) as never).set(noAuth);
      expect(res.status).toBe(401);
    });

    if (!c.allow.includes('owner')) {
      it(`${c.label}: rejects an owner token with 403`, async () => {
        const res = await c.req(request(app.getHttpServer()) as never).set(asOwner('owner-a'));
        expect(res.status).toBe(403);
      });
    }
    if (!c.allow.includes('backoffice')) {
      it(`${c.label}: rejects a backoffice token with 403`, async () => {
        const res = await c.req(request(app.getHttpServer()) as never).set(asBackoffice);
        expect(res.status).toBe(403);
      });
    }
  }

  it('owner B cannot read owner A settlement request detail (404, not leaked)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/settlement-requests/${ownerARequestId}`)
      .set(asOwner('owner-b'));
    expect(res.status).toBe(404);
  });

  it('owner B cannot pay owner A settlement request', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/settlement-requests/${ownerARequestId}/payment`)
      .set(asOwner('owner-b'))
      .send({ idempotencyKey: 'owner-b-key' });
    expect([403, 404]).toContain(res.status);
  });

  it('owner B cannot download owner A meeting attachment', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/backoffice/meetings/${ownerAAttachmentId}`)
      .set(asOwner('owner-b'));
    expect(res.status).toBe(404);
  });

  it('backoffice CAN download owner A meeting attachment (permitted cross-owner review action)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/backoffice/meetings/${ownerAAttachmentId}`)
      .set(asBackoffice);
    expect(res.status).toBe(200);
  });
});
