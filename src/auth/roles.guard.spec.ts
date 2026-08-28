import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '../common/enums/role.enum';
import { RolesGuard } from './roles.guard';

function context(user: unknown, required: Role[]) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  const guard = new RolesGuard(reflector);
  return {
    guard,
    ctx: {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext,
  };
}

describe('RolesGuard', () => {
  it('rejects a missing user and accepts the required role', () => {
    const missing = context(undefined, [Role.Owner]);
    expect(() => missing.guard.canActivate(missing.ctx)).toThrow(ForbiddenException);
    const allowed = context({ roles: [Role.Owner] }, [Role.Owner]);
    expect(allowed.guard.canActivate(allowed.ctx)).toBe(true);
  });

  it('rejects cross-role access', () => {
    const { guard, ctx } = context({ roles: [Role.Owner] }, [Role.BackofficeEmployee]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
