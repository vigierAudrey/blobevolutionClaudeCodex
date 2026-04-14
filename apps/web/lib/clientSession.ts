import { apiClient } from './apiClient';

export type SessionUser = Awaited<ReturnType<typeof apiClient.me>>;
export type SessionRole = SessionUser['role'];

export class SessionRequiredError extends Error {
  readonly code = 'SESSION_REQUIRED';

  constructor() {
    super('Session authentication required');
    this.name = 'SessionRequiredError';
  }
}

export class RoleMismatchError extends Error {
  readonly code = 'ROLE_MISMATCH';

  constructor(
    readonly expectedRole: SessionRole,
    readonly actualRole: SessionRole,
  ) {
    super(`Expected ${expectedRole}, received ${actualRole}`);
    this.name = 'RoleMismatchError';
  }
}

function classifyApiError(error: unknown): SessionRequiredError | null {
  const errorCode = typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : null;
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : null;
  if (errorCode === 'SESSION_EXPIRED' || status === 401) {
    return new SessionRequiredError();
  }
  return null;
}

/**
 * Verifies the server session is active.
 * Throws SessionRequiredError on 401 / SESSION_EXPIRED.
 * Never reads blob_session_hint — truth comes from the server.
 */
export async function requireClientSession(): Promise<SessionUser> {
  try {
    return await apiClient.me();
  } catch (error) {
    const sessionError = classifyApiError(error);
    if (sessionError) throw sessionError;
    throw error;
  }
}

export async function requireClientRole(requiredRole: SessionRole): Promise<SessionUser> {
  try {
    const user = await apiClient.me();
    if (user.role !== requiredRole) {
      throw new RoleMismatchError(requiredRole, user.role);
    }
    return user;
  } catch (error) {
    if (error instanceof RoleMismatchError) {
      throw error;
    }

    const sessionError = classifyApiError(error);
    if (sessionError) throw sessionError;

    throw error;
  }
}
