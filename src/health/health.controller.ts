import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckError,
  HealthCheckService,
  HealthIndicatorResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Socket } from 'node:net';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  getHealth() {
    return this.health.check([
      () => this.db.pingCheck('mysql'),
      () =>
        this.httpProbe(
          'keycloak',
          `${process.env.KEYCLOAK_INTERNAL_ISSUER ?? process.env.KEYCLOAK_ISSUER}/.well-known/openid-configuration`,
        ),
      () => this.httpProbe('minio', `${process.env.MINIO_ENDPOINT}/minio/health/live`),
      () => this.tcpProbe('clamav', process.env.CLAMAV_HOST!, Number(process.env.CLAMAV_PORT)),
    ]);
  }

  private async httpProbe(name: string, url: string): Promise<HealthIndicatorResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
      return { [name]: { status: 'up' } };
    } catch (error) {
      // Terminus only aggregates a failed check into its own structured 503 if
      // the indicator throws a HealthCheckError — a plain Error propagates past
      // HealthCheckExecutor and turns the whole endpoint into an opaque 500,
      // hiding which dependency actually failed.
      throw new HealthCheckError(`${name} check failed`, {
        [name]: { status: 'down', message: (error as Error).message },
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private tcpProbe(name: string, host: string, port: number): Promise<HealthIndicatorResult> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const fail = (error: Error) => {
        clearTimeout(timeout);
        reject(
          new HealthCheckError(`${name} check failed`, {
            [name]: { status: 'down', message: error.message },
          }),
        );
      };
      const timeout = setTimeout(() => socket.destroy(new Error(`${name} probe timed out`)), 2_000);
      socket.once('error', fail);
      socket.connect(port, host, () => {
        socket.write('PING\n');
        clearTimeout(timeout);
        socket.destroy();
        resolve({ [name]: { status: 'up' } });
      });
    });
  }
}
