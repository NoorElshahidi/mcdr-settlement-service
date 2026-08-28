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
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role =
      req.headers['x-test-role'] === Role.BackofficeEmployee ? Role.BackofficeEmployee : Role.Owner;
    req.user = {
      subject: role === Role.Owner ? 'fs-owner' : 'fs-backoffice',
      email: `${role}@example.test`,
      displayName: role,
      roles: [role],
    };
    return true;
  }
}

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
// Industry-standard antivirus test signature — not real malware; every AV
// engine (including ClamAV) is required to flag it as a known test file.
// ClamAV's PDF module extracts and scans actual content streams rather than
// raw bytes once it recognizes the PDF magic header, so the signature has to
// sit inside a real stream object — appending it straight after "%PDF" is
// invisible to the scanner (confirmed against the live ClamAV container).
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const eicarAsPdf = Buffer.from(
  `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Length ${EICAR.length}>>\nstream\n${EICAR}\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF`,
);
const asOwner = { 'x-test-role': Role.Owner };
const asBackoffice = { 'x-test-role': Role.BackofficeEmployee };

describe('file security', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let s3: S3Client;

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
    await dataSource.getRepository(Company).save({
      crn: `FS-${Date.now()}`,
      name: 'File Security Co',
      settlementRequired: true,
      eligibilityReason: 'x',
    });
    await dataSource.getRepository(User).save({
      keycloakSubject: 'fs-backoffice',
      email: 'fs-backoffice@example.test',
      displayName: 'FS Backoffice',
      role: Role.BackofficeEmployee,
      isActive: true,
    });
    s3 = new S3Client({
      endpoint: process.env.MINIO_ENDPOINT,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY!,
        secretAccessKey: process.env.MINIO_SECRET_KEY!,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an oversized attachment', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024, 'a')]);
    const res = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner)
      .attach('file', big, { filename: 'huge.pdf', contentType: 'application/pdf' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('rejects a disallowed MIME type', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner)
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'evil.html',
        contentType: 'text/html',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_INVALID');
  });

  it('rejects a file whose signature does not match its declared MIME type', async () => {
    // Declares application/pdf + a .pdf filename, but the bytes are plain text —
    // exercises the magic-byte check independently of the extension/MIME check.
    const res = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner)
      .attach('file', Buffer.from('not actually a pdf'), {
        filename: 'fake.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_INVALID');
  });

  it('rejects a file flagged by ClamAV and cleans it up from MinIO', async () => {
    const before = await s3.send(
      new ListObjectsV2Command({
        Bucket: process.env.MINIO_BUCKET,
        Prefix: 'attachments/pending/',
      }),
    );

    const res = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner)
      .attach('file', eicarAsPdf, { filename: 'eicar.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_REJECTED');

    // A rejected scan must not leave the object behind in MinIO — the pending
    // prefix's object count should be exactly what it was before the attempt.
    const after = await s3.send(
      new ListObjectsV2Command({
        Bucket: process.env.MINIO_BUCKET,
        Prefix: 'attachments/pending/',
      }),
    );
    expect(after.KeyCount ?? 0).toBe(before.KeyCount ?? 0);
    expect(
      await dataSource.query("SELECT id FROM documents WHERE original_name LIKE '%eicar%'"),
    ).toHaveLength(0);
  });

  it('allows the same attachment content to be uploaded more than once (independent documents)', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner)
      .attach('file', pdf, { filename: 'dup.pdf', contentType: 'application/pdf' });
    const second = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner)
      .attach('file', pdf, { filename: 'dup.pdf', contentType: 'application/pdf' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.documentId).not.toBe(second.body.data.documentId);
  });

  it('rejects a second settlement-document upload for the same meeting while still eligible (not just after full settlement)', async () => {
    const uploadA = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner)
      .attach('file', pdf, { filename: 'minutes-a.pdf', contentType: 'application/pdf' });
    const uploadB = await request(app.getHttpServer())
      .post('/api/v1/backoffice/meetings/meeting-attachment')
      .set(asOwner)
      .attach('file', pdf, { filename: 'minutes-b.pdf', contentType: 'application/pdf' });
    const crnRow = await dataSource.query(
      'SELECT crn FROM companies WHERE settlement_required = 1 LIMIT 1',
    );
    const created = await request(app.getHttpServer())
      .post('/api/v1/settlement-requests')
      .set(asOwner)
      .send({
        crn: crnRow[0].crn,
        meetings: [
          {
            meetingAt: '2020-01-01T10:00:00.000Z',
            capital: 1000,
            attachmentDocumentId: uploadA.body.data.documentId,
          },
          {
            meetingAt: '2020-02-01T10:00:00.000Z',
            capital: 1000,
            attachmentDocumentId: uploadB.body.data.documentId,
          },
        ],
      });
    const requestId = created.body.data.id;
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/backoffice/settlement-requests/${requestId}`)
      .set(asBackoffice);
    const [meetingA, meetingB] = detail.body.data.meetings;
    await request(app.getHttpServer())
      .patch(`/api/v1/backoffice/settlement-requests/${requestId}/fees`)
      .set(asBackoffice)
      .send({
        fees: [
          { meetingId: meetingA.id, amount: 100 },
          { meetingId: meetingB.id, amount: 100 },
        ],
      });
    await request(app.getHttpServer())
      .post(`/api/v1/backoffice/settlement-requests/${requestId}/approve`)
      .set(asBackoffice)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/settlement-requests/${requestId}/payment`)
      .set(asOwner)
      .send({ idempotencyKey: `fs-dup-settlement-${requestId}` })
      .expect(201);

    // Settle only meeting A — request becomes PARTIALLY_SETTLED, meeting B is
    // still open, so a second upload for meeting A must be rejected while the
    // request is still in a state that would otherwise accept uploads.
    const firstSettle = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/meetings/${meetingA.id}/settlement-document`)
      .set(asBackoffice)
      .attach('file', pdf, { filename: 'settled-a.pdf', contentType: 'application/pdf' });
    expect(firstSettle.status).toBe(201);
    expect(firstSettle.body.data.status).toBe('PARTIALLY_SETTLED');

    const secondSettle = await request(app.getHttpServer())
      .post(`/api/v1/backoffice/meetings/${meetingA.id}/settlement-document`)
      .set(asBackoffice)
      .attach('file', pdf, { filename: 'settled-a-again.pdf', contentType: 'application/pdf' });
    expect(secondSettle.status).toBe(400);
    expect(secondSettle.body.error.code).toBe('DOCUMENT_ALREADY_ATTACHED');
  });
});
