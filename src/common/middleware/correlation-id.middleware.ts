import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.header('x-correlation-id');
    const correlationId =
      incoming && /^[a-zA-Z0-9._:-]{1,100}$/.test(incoming) ? incoming : randomUUID();
    request.correlationId = correlationId;
    response.setHeader('X-Correlation-Id', correlationId);
    next();
  }
}
