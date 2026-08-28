import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { Role } from '../common/enums/role.enum';

type KeycloakClaims = {
  sub?: string;
  email?: string;
  name?: string;
  realm_access?: { roles?: string[] };
};

@Injectable()
export class KeycloakAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers.authorization?.startsWith('Bearer ')
      ? request.headers.authorization.slice(7)
      : undefined;
    if (!token) throw new UnauthorizedException('Bearer token required');
    try {
      if (!process.env.KEYCLOAK_ISSUER || !process.env.KEYCLOAK_AUDIENCE)
        throw new Error('Keycloak configuration missing');
      // JWKS is fetched server-to-server (KEYCLOAK_INTERNAL_ISSUER behind Docker),
      // but the `iss` claim below must match what the browser's token actually
      // carries (KEYCLOAK_ISSUER) — the two hostnames differ under Docker.
      const jwksIssuer = process.env.KEYCLOAK_INTERNAL_ISSUER ?? process.env.KEYCLOAK_ISSUER;
      this.jwks ??= createRemoteJWKSet(new URL(`${jwksIssuer}/protocol/openid-connect/certs`));
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: process.env.KEYCLOAK_ISSUER,
        audience: process.env.KEYCLOAK_AUDIENCE,
      });
      const claims = payload as KeycloakClaims;
      if (!claims.sub) throw new Error('subject missing');
      request.user = {
        subject: claims.sub,
        email: claims.email,
        displayName: claims.name,
        roles: (claims.realm_access?.roles ?? []).filter((role): role is Role =>
          Object.values(Role).includes(role as Role),
        ),
      } satisfies AuthenticatedUser;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
