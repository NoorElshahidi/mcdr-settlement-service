import { Role } from '../enums/role.enum';

export interface AuthenticatedUser {
  subject: string;
  email?: string;
  displayName?: string;
  roles: readonly Role[];
}
