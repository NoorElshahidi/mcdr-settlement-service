import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));
import { AppModule } from '../src/app.module';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';

describe('health (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    await app.init();
  });
  afterAll(async () => app?.close());
  it('returns a dependency-backed health response without authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body.success).toBe(true);
        expect(body.data.status).toBe('ok');
        expect(body.data.info).toEqual(
          expect.objectContaining({
            mysql: expect.any(Object),
            keycloak: { status: 'up' },
            minio: { status: 'up' },
            clamav: { status: 'up' },
          }),
        );
      });
  });
});
