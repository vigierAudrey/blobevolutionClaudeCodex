/**
 * Unit tests for clientSession helpers.
 *
 * Invariants verified:
 *   1. requireClientSession() — returns user when server session is valid
 *   2. requireClientSession() — throws SessionRequiredError on 401 / SESSION_EXPIRED
 *   3. requireClientSession() — re-throws other (non-session) errors
 *   4. requireClientSession() — never reads blob_session_hint (getTokens not called)
 *   5. requireClientRole() — returns user when role matches
 *   6. requireClientRole() — throws RoleMismatchError when role does not match
 *   7. requireClientRole() — throws SessionRequiredError on 401 (not RoleMismatchError)
 */
import {
  requireClientSession,
  requireClientRole,
  SessionRequiredError,
  RoleMismatchError,
} from '../clientSession';
import { apiClient } from '../apiClient';

jest.mock('../apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    getTokens: jest.fn(), // must NOT be called
  },
}));

const mockMe = apiClient.me as jest.Mock;
const mockGetTokens = (apiClient as unknown as { getTokens: jest.Mock }).getTokens;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requireClientSession', () => {
  it('returns user when server session is valid', async () => {
    const user = { id: 'u1', email: 'a@b.com', role: 'RIDER' };
    mockMe.mockResolvedValueOnce(user);

    const result = await requireClientSession();

    expect(result).toBe(user);
    expect(mockMe).toHaveBeenCalledTimes(1);
  });

  it('never reads blob_session_hint — getTokens must not be called', async () => {
    mockMe.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', role: 'RIDER' });

    await requireClientSession();

    expect(mockGetTokens).not.toHaveBeenCalled();
  });

  it('throws SessionRequiredError when server returns code=SESSION_EXPIRED', async () => {
    const err = Object.assign(new Error('Session expirée'), { code: 'SESSION_EXPIRED' });
    mockMe.mockRejectedValueOnce(err);

    await expect(requireClientSession()).rejects.toBeInstanceOf(SessionRequiredError);
  });

  it('throws SessionRequiredError when server returns status=401', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockMe.mockRejectedValueOnce(err);

    await expect(requireClientSession()).rejects.toBeInstanceOf(SessionRequiredError);
  });

  it('re-throws non-session errors (e.g. network failure)', async () => {
    const err = new Error('Network error');
    mockMe.mockRejectedValueOnce(err);

    const caught = await requireClientSession().catch((e) => e);
    expect(caught).toBe(err);
    expect(caught).not.toBeInstanceOf(SessionRequiredError);
  });

  it('re-throws 403 as-is (not a SessionRequiredError)', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    mockMe.mockRejectedValueOnce(err);

    const caught = await requireClientSession().catch((e) => e);
    expect(caught).toBe(err);
    expect(caught).not.toBeInstanceOf(SessionRequiredError);
  });
});

describe('requireClientRole', () => {
  it('returns user when role matches', async () => {
    const user = { id: 'u1', email: 'a@b.com', role: 'PRO' };
    mockMe.mockResolvedValueOnce(user);

    const result = await requireClientRole('PRO');
    expect(result).toBe(user);
  });

  it('throws RoleMismatchError when user has wrong role', async () => {
    mockMe.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', role: 'RIDER' });

    await expect(requireClientRole('PRO')).rejects.toBeInstanceOf(RoleMismatchError);
  });

  it('RoleMismatchError carries expected/actual role info', async () => {
    mockMe.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', role: 'RIDER' });

    const err = await requireClientRole('ADMIN').catch((e) => e);
    expect(err).toBeInstanceOf(RoleMismatchError);
    expect((err as RoleMismatchError).expectedRole).toBe('ADMIN');
    expect((err as RoleMismatchError).actualRole).toBe('RIDER');
  });

  it('throws SessionRequiredError on 401 (not RoleMismatchError)', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockMe.mockRejectedValueOnce(err);

    await expect(requireClientRole('ADMIN')).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(requireClientRole('ADMIN')).rejects.not.toBeInstanceOf(RoleMismatchError);
  });

  it('throws SessionRequiredError on code=SESSION_EXPIRED (not RoleMismatchError)', async () => {
    const err = Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' });
    mockMe.mockRejectedValueOnce(err);

    await expect(requireClientRole('PRO')).rejects.toBeInstanceOf(SessionRequiredError);
  });
});
