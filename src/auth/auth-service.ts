import type { AuthenticationStore } from '../application/ports.js';
import { AuthenticationError } from '../domain/errors.js';
import type { Principal } from '../domain/types.js';

export class AuthService {
  constructor(private readonly store: AuthenticationStore) {}

  authenticate(header: string | undefined): Principal {
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) throw new AuthenticationError();
    const subjectId = this.store.authenticateToken(match[1]);
    if (!subjectId) throw new AuthenticationError();
    return { subjectId };
  }
}
