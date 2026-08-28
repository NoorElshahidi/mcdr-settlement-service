import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

const SENSITIVE_FIELDS = new Set([
  'password',
  'newPassword',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_FIELDS.has(key) ? '[REDACTED]' : redact(entry),
    ]),
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    this.logger.error(
      {
        event: 'http_exception',
        correlationId: request.correlationId,
        method: request.method,
        route: request.originalUrl,
        userId: request.user?.subject,
        status,
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
        body: redact(request.body),
      },
      'HTTP exception',
    );
    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : {
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
          };
    response.status(status).json(
      typeof body === 'object'
        ? body
        : {
            success: false,
            error: { code: 'HTTP_ERROR', message: String(body), path: request.url },
          },
    );
  }
}
