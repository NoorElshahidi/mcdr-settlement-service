import { ConnectedSocket, OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: 'notifications',
  cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001' },
})
export class NotificationsGateway implements OnGatewayConnection {
  private static server?: Server;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  afterInit(server: Server): void {
    NotificationsGateway.server = server;
  }
  static emitToSubject(subject: string, payload: unknown): void {
    NotificationsGateway.server?.to(`user:${subject}`).emit('notification', payload);
  }

  async handleConnection(@ConnectedSocket() socket: Socket): Promise<void> {
    const token =
      typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token
        : socket.handshake.headers.authorization?.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : undefined;
    try {
      const issuer = process.env.KEYCLOAK_ISSUER;
      const audience = process.env.KEYCLOAK_AUDIENCE;
      if (!token || !issuer || !audience) throw new Error('missing websocket credentials');
      // See keycloak-auth.guard.ts: JWKS fetch needs the server-reachable host,
      // issuer-claim validation needs the browser-facing host that signed the token.
      const jwksIssuer = process.env.KEYCLOAK_INTERNAL_ISSUER ?? issuer;
      this.jwks ??= createRemoteJWKSet(new URL(`${jwksIssuer}/protocol/openid-connect/certs`));
      const { payload } = await jwtVerify(token, this.jwks, { issuer, audience });
      if (!payload.sub) throw new Error('subject missing');
      await socket.join(`user:${payload.sub}`);
    } catch {
      socket.disconnect(true);
    }
  }
}
