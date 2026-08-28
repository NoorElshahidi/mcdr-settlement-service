import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthenticatedUser } from '../common/types/authenticated-user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user || !required.some((role) => user.roles.includes(role)))
      throw new ForbiddenException('Insufficient role');
    return true;
  }
}
