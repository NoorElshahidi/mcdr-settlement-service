import { AuthenticatedUser } from '../common/types/authenticated-user';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      correlationId?: string;
    }
  }
}

export {};
