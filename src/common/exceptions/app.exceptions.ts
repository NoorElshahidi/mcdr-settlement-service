import { HttpException, HttpStatus } from '@nestjs/common';

export class DomainException extends HttpException {
  constructor(code: string, message: string, status = HttpStatus.BAD_REQUEST) {
    super({ success: false, error: { code, message } }, status);
  }
}

export class InvalidTransitionException extends DomainException {
  constructor() {
    super('INVALID_STATUS_TRANSITION', 'This request cannot transition from its current status.');
  }
}

export class ActiveRequestExistsException extends DomainException {
  constructor() {
    super('ACTIVE_REQUEST_EXISTS', 'You already have an active settlement request.');
  }
}
