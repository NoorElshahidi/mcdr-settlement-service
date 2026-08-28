import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { jwtVerify } from 'jose';
import { KeycloakAuthGuard } from './keycloak-auth.guard';

jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const mockedJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

const ctx = (authorization?: string) =>
  ({
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
    }),
  }) as unknown as ExecutionContext;

describe('KeycloakAuthGuard', () => {
  it('rejects missing credentials before contacting the identity provider', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    await expect(new KeycloakAuthGuard(reflector).canActivate(ctx())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('allows explicitly public endpoints without a token', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    await expect(new KeycloakAuthGuard(reflector).canActivate(ctx())).resolves.toBe(true);
  });

  it('rejects invalid signatures and tokens without a subject', async () => {
    process.env.KEYCLOAK_ISSUER = 'https://keycloak.example.test/realms/mcdr';
    process.env.KEYCLOAK_AUDIENCE = 'mcdr-api';
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    mockedJwtVerify.mockRejectedValueOnce(new Error('bad signature'));
    await expect(
      new KeycloakAuthGuard(reflector).canActivate(ctx('Bearer invalid')),
    ).rejects.toThrow(UnauthorizedException);
    mockedJwtVerify.mockResolvedValueOnce({ payload: { aud: 'mcdr-api' } } as never);
    await expect(
      new KeycloakAuthGuard(reflector).canActivate(ctx('Bearer missing-sub')),
    ).rejects.toThrow(UnauthorizedException);
    mockedJwtVerify.mockReset();
  });
});
