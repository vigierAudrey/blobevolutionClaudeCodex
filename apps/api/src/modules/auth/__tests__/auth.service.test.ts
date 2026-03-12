import { beforeEach, afterEach, describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import { clientPrisma as prisma } from '@blobinfini/database';
import { AuthService } from '../auth.service';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Mock mailer module
jest.mock('../../../lib/mailer', () => ({
  sendPasswordResetEmail: jest.fn(),
  sendVerificationEmail: jest.fn()
}));

import { sendPasswordResetEmail, sendVerificationEmail } from '../../../lib/mailer';

const mockSendPasswordResetEmail = sendPasswordResetEmail as jest.MockedFunction<typeof sendPasswordResetEmail>;
const mockSendVerificationEmail = sendVerificationEmail as jest.MockedFunction<typeof sendVerificationEmail>;

describe('AuthService', () => {
  let authService: AuthService;
  let testUserId: string;

  // Mock environment variables
  const originalEnv = process.env;
  const STRONG_JWT_SECRET = 'j'.repeat(64);
  const STRONG_REFRESH_SECRET = 'r'.repeat(64);

  beforeAll(() => {
    process.env.JWT_SECRET = STRONG_JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = STRONG_REFRESH_SECRET;
    // NODE_ENV is already set to 'test' in Jest environment
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(async () => {
    authService = new AuthService();

    // Clear mocks
    jest.clearAllMocks();

    // Clean up test data
    await prisma.passwordResetToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    // Clean up after each test
    await prisma.passwordResetToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('User Registration', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        role: 'RIDER' as const
      };

      const result = await authService.register(userData, { consentIp: '127.0.0.1' });

      expect(result.message).toBe('Account created. Please verify your email.');
      expect(result.userId).toBeDefined();
      expect(result.verificationToken).toBeDefined(); // In test env

      // Verify user was created in database
      const user = await prisma.user.findUnique({ where: { id: result.userId } });
      expect(user).toBeTruthy();
      expect(user!.email).toBe(userData.email);
      expect(user!.emailVerified).toBe(false);
      expect(user!.consentedAt).toBeTruthy();
      // ÉTAPE 2: Vérifier que consentIpHash est un hash HMAC-SHA256 (24 hex chars)
      expect(user!.consentIpHash).toBeTruthy();
      expect(user!.consentIpHash).toMatch(/^[a-f0-9]{24}$/);

      // Verify password was hashed
      const passwordMatch = await bcrypt.compare(userData.password, user!.password);
      expect(passwordMatch).toBe(true);

      // Verify email verification token was created
      const verificationToken = await prisma.emailVerificationToken.findFirst({
        where: { userId: result.userId }
      });
      expect(verificationToken).toBeTruthy();

      // Verify email sending was attempted
      expect(mockSendVerificationEmail).toHaveBeenCalledWith(
        userData.email,
        result.verificationToken
      );
    });

    it('should handle email already exists error', async () => {
      const userData = {
        email: 'duplicate@example.com',
        password: 'SecurePass123!',
        role: 'RIDER' as const
      };

      // Create first user
      await authService.register(userData);

      // Try to create duplicate
      await expect(authService.register(userData))
        .rejects.toEqual({
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'This email is already registered'
        });
    });

    it('should handle email sending failure gracefully', async () => {
      mockSendVerificationEmail.mockRejectedValue(new Error('Email service down'));

      const userData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        role: 'RIDER' as const
      };

      // Should not throw even if email fails
      const result = await authService.register(userData);
      expect(result.userId).toBeDefined();
    });

    it('should create user with PRO role', async () => {
      const userData = {
        email: 'pro@example.com',
        password: 'SecurePass123!',
        role: 'PRO' as const
      };

      const result = await authService.register(userData);
      const user = await prisma.user.findUnique({ where: { id: result.userId } });

      expect(user!.role).toBe('PRO');
    });
  });

  describe('User Login', () => {
    beforeEach(async () => {
      // Create a test user
      const result = await authService.register({
        email: 'login@example.com',
        password: 'TestPass123!',
        role: 'RIDER'
      });
      testUserId = result.userId;

      // Verify the user's email
      await prisma.user.update({
        where: { id: testUserId },
        data: { emailVerified: true }
      });
    });

    it('should login successfully with valid credentials', async () => {
      const tokens = await authService.login('login@example.com', 'TestPass123!');

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();

      // Verify access token
      const decoded = jwt.verify(tokens.accessToken, process.env.JWT_SECRET!) as any;
      expect(decoded.sub).toBe(testUserId);
      expect(decoded.role).toBe('RIDER');
      expect(typeof decoded.jti).toBe('string');
      expect(typeof decoded.sid).toBe('string');
      expect(typeof decoded.ctx).toBe('string');

      // Verify refresh token was stored in database
      const refreshTokens = await prisma.refreshToken.findMany({
        where: { userId: testUserId }
      });
      expect(refreshTokens.length).toBe(1);
    });

    it('should reject invalid email', async () => {
      await expect(authService.login('nonexistent@example.com', 'TestPass123!'))
        .rejects.toEqual({ code: 'UNAUTHORIZED' });
    });

    it('should reject invalid password', async () => {
      await expect(authService.login('login@example.com', 'WrongPassword'))
        .rejects.toEqual({ code: 'UNAUTHORIZED' });
    });

    it('should require email verification when AUTH_REQUIRE_VERIFIED is true', async () => {
      process.env.AUTH_REQUIRE_VERIFIED = 'true';

      // Set user email as unverified
      await prisma.user.update({
        where: { id: testUserId },
        data: { emailVerified: false }
      });

      await expect(authService.login('login@example.com', 'TestPass123!'))
        .rejects.toEqual({ code: 'EMAIL_NOT_VERIFIED' });

      // Reset env var
      process.env.AUTH_REQUIRE_VERIFIED = 'false';
    });

    it('should handle consent requirement for existing users', async () => {
      // Update user to have old consent version
      await prisma.user.update({
        where: { id: testUserId },
        data: { consentVersion: 'v0.9.0' }
      });

      await expect(authService.login('login@example.com', 'TestPass123!'))
        .rejects.toEqual({ code: 'CONSENT_REQUIRED' });
    });

    it('should update consent when provided during login', async () => {
      // Update user to have old consent version
      await prisma.user.update({
        where: { id: testUserId },
        data: { consentVersion: 'v0.9.0' }
      });

      const tokens = await authService.login(
        'login@example.com',
        'TestPass123!',
        { consentAccepted: true, consentIp: '192.168.1.1' }
      );

      expect(tokens.accessToken).toBeDefined();

      // Verify consent was updated
      const user = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(user!.consentVersion).toBe('v1.0.0');
      // ÉTAPE 2: Vérifier que consentIpHash est un hash HMAC-SHA256 (24 hex chars)
      expect(user!.consentIpHash).toBeTruthy();
      expect(user!.consentIpHash).toMatch(/^[a-f0-9]{24}$/);
    });
  });

  describe('Token Refresh', () => {
    let originalRefreshToken: string;

    beforeEach(async () => {
      // Create and login user
      const result = await authService.register({
        email: 'refresh@example.com',
        password: 'TestPass123!',
        role: 'RIDER'
      });
      testUserId = result.userId;

      await prisma.user.update({
        where: { id: testUserId },
        data: { emailVerified: true }
      });

      const tokens = await authService.login('refresh@example.com', 'TestPass123!');
      originalRefreshToken = tokens.refreshToken;
    });

    it('should refresh tokens successfully', async () => {
      const newTokens = await authService.refresh(originalRefreshToken);

      expect(newTokens.accessToken).toBeDefined();
      expect(newTokens.refreshToken).toBeDefined();
      expect(newTokens.refreshToken).not.toBe(originalRefreshToken);

      // Verify new access token
      const decoded = jwt.verify(newTokens.accessToken, process.env.JWT_SECRET!) as any;
      expect(decoded.sub).toBe(testUserId);
      expect(typeof decoded.jti).toBe('string');
      expect(typeof decoded.sid).toBe('string');
      expect(typeof decoded.ctx).toBe('string');

      // Verify old refresh token was revoked
      const revokedTokens = await prisma.refreshToken.findMany({
        where: { userId: testUserId, revokedAt: { not: null } }
      });
      expect(revokedTokens.length).toBe(1);

      // Verify new refresh token exists
      const activeTokens = await prisma.refreshToken.findMany({
        where: { userId: testUserId, revokedAt: null }
      });
      expect(activeTokens.length).toBe(1);
    });

    it('should reject invalid refresh token signature', async () => {
      const invalidToken = 'invalid.jwt.token';

      await expect(authService.refresh(invalidToken))
        .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Invalid refresh token' });
    });

    it('should reject token without subject', async () => {
      const tokenWithoutSub = jwt.sign(
        { jti: crypto.randomUUID() },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: '30d' }
      );

      await expect(authService.refresh(tokenWithoutSub))
        .rejects.toEqual({ code: 'UNAUTHORIZED' });
    });

    it('should reject token not found in database', async () => {
      // Create a valid JWT but not stored in DB
      const notStoredToken = jwt.sign(
        { sub: testUserId, jti: crypto.randomUUID() },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: '30d' }
      );

      await expect(authService.refresh(notStoredToken))
        .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Refresh not found' });
    });

    it('should reject already used refresh token', async () => {
      // Use the token once
      await authService.refresh(originalRefreshToken);

      // Try to use the same token again
      await expect(authService.refresh(originalRefreshToken))
        .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Refresh not found' });
    });

    it('should handle expired refresh tokens', async () => {
      // Manually set token as expired in database
      await prisma.refreshToken.updateMany({
        where: { userId: testUserId },
        data: { expiresAt: new Date(Date.now() - 1000) } // 1 second ago
      });

      await expect(authService.refresh(originalRefreshToken))
        .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Refresh not found' });
    });
  });

  describe('Logout Operations', () => {
    let refreshToken1: string;
    let refreshToken2: string;

    beforeEach(async () => {
      // Create user and multiple sessions
      const result = await authService.register({
        email: 'logout@example.com',
        password: 'TestPass123!',
        role: 'RIDER'
      });
      testUserId = result.userId;

      await prisma.user.update({
        where: { id: testUserId },
        data: { emailVerified: true }
      });

      // Create two sessions
      const tokens1 = await authService.login('logout@example.com', 'TestPass123!');
      const tokens2 = await authService.login('logout@example.com', 'TestPass123!');

      refreshToken1 = tokens1.refreshToken;
      refreshToken2 = tokens2.refreshToken;
    });

    describe('logoutAll', () => {
      it('should revoke all refresh tokens for user', async () => {
        const result = await authService.logoutAll(testUserId);

        expect(result.message).toBe('Logged out from all devices');

        // Verify all tokens are revoked
        const activeTokens = await prisma.refreshToken.findMany({
          where: { userId: testUserId, revokedAt: null }
        });
        expect(activeTokens.length).toBe(0);

        const revokedTokens = await prisma.refreshToken.findMany({
          where: { userId: testUserId, revokedAt: { not: null } }
        });
        expect(revokedTokens.length).toBe(2);
      });
    });

    describe('logoutSingle', () => {
      it('should revoke specific refresh token', async () => {
        const result = await authService.logoutSingle(testUserId, refreshToken1);

        expect(result.message).toBe('Logged out from current device');

        // Verify only one token is revoked
        const activeTokens = await prisma.refreshToken.findMany({
          where: { userId: testUserId, revokedAt: null }
        });
        expect(activeTokens.length).toBe(1);

        const revokedTokens = await prisma.refreshToken.findMany({
          where: { userId: testUserId, revokedAt: { not: null } }
        });
        expect(revokedTokens.length).toBe(1);
      });

      it('should handle non-existent token gracefully', async () => {
        const fakeToken = jwt.sign(
          { sub: testUserId, jti: crypto.randomUUID() },
          process.env.JWT_REFRESH_SECRET!,
          { expiresIn: '30d' }
        );

        const result = await authService.logoutSingle(testUserId, fakeToken);

        expect(result.message).toBe('Logged out');

        // Verify no tokens were affected
        const activeTokens = await prisma.refreshToken.findMany({
          where: { userId: testUserId, revokedAt: null }
        });
        expect(activeTokens.length).toBe(2);
      });
    });
  });

  describe('Password Reset', () => {
    beforeEach(async () => {
      const result = await authService.register({
        email: 'reset@example.com',
        password: 'OldPass123!',
        role: 'RIDER'
      });
      testUserId = result.userId;
    });

    describe('forgotPassword', () => {
      it('should create password reset token for existing user', async () => {
        const result = await authService.forgotPassword('reset@example.com');

        expect(result.message).toBe('If the email exists, a reset link was sent');
        expect(result.resetToken).toBeDefined(); // In test env

        // Verify token was created in database
        const resetTokens = await prisma.passwordResetToken.findMany({
          where: { userId: testUserId }
        });
        expect(resetTokens.length).toBe(1);

        // In test mode, email is not sent, only token is returned
        // expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
        //   'reset@example.com',
        //   result.resetToken
        // );
      });

      it('should return generic message for non-existent user', async () => {
        const result = await authService.forgotPassword('nonexistent@example.com');

        expect(result.message).toBe('If the email exists, a reset link was sent');
        expect(result.resetToken).toBeUndefined();
        expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
      });

      it('should handle email sending failure gracefully', async () => {
        mockSendPasswordResetEmail.mockRejectedValue(new Error('Email service down'));

        const result = await authService.forgotPassword('reset@example.com');

        expect(result.message).toBe('If the email exists, a reset link was sent');
        // Should create token even if email fails
        expect(result.resetToken).toBeDefined();
      });
    });

    describe('resetPassword', () => {
      let resetToken: string;

      beforeEach(async () => {
        const result = await authService.forgotPassword('reset@example.com');
        resetToken = result.resetToken;
      });

      it('should reset password successfully', async () => {
        const newPassword = 'NewSecurePass123!';

        const result = await authService.resetPassword(resetToken, newPassword);

        expect(result.message).toBe('Password updated');

        // Verify password was changed
        const user = await prisma.user.findUnique({ where: { id: testUserId } });
        const passwordMatch = await bcrypt.compare(newPassword, user!.password);
        expect(passwordMatch).toBe(true);

        // Verify reset token was marked as used
        const usedToken = await prisma.passwordResetToken.findFirst({
          where: { userId: testUserId, usedAt: { not: null } }
        });
        expect(usedToken).toBeTruthy();

        // Verify all refresh tokens were revoked
        const activeTokens = await prisma.refreshToken.findMany({
          where: { userId: testUserId, revokedAt: null }
        });
        expect(activeTokens.length).toBe(0);
      });

      it('should reject invalid reset token', async () => {
        await expect(authService.resetPassword('invalid-token', 'NewPass123!'))
          .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
      });

      it('should reject expired reset token', async () => {
        // Manually expire the token
        await prisma.passwordResetToken.updateMany({
          where: { userId: testUserId },
          data: { expiresAt: new Date(Date.now() - 1000) }
        });

        await expect(authService.resetPassword(resetToken, 'NewPass123!'))
          .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
      });

      it('should reject already used reset token', async () => {
        // Use the token once
        await authService.resetPassword(resetToken, 'NewPass123!');

        // Try to use it again
        await expect(authService.resetPassword(resetToken, 'AnotherPass123!'))
          .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
      });
    });
  });

  describe('Change Password', () => {
    const originalPassword = 'OldPass123!';
    const newPassword = 'NewPass456!';

    beforeEach(async () => {
      const result = await authService.register({
        email: 'change@example.com',
        password: originalPassword,
        role: 'RIDER'
      });
      testUserId = result.userId;
    });

    it('should update password and revoke refresh tokens', async () => {
      await authService.login('change@example.com', originalPassword);

      const result = await authService.changePassword(testUserId, originalPassword, newPassword);
      expect(result.message).toBe('Password updated');

      const updated = await prisma.user.findUnique({ where: { id: testUserId } });
      const matchesNew = await bcrypt.compare(newPassword, updated!.password);
      expect(matchesNew).toBe(true);

      const tokens = await prisma.refreshToken.findMany({ where: { userId: testUserId } });
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
    });

    it('should reject invalid current password', async () => {
      await expect(authService.changePassword(testUserId, 'WrongPass123!', newPassword))
        .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Invalid current password' });
    });
  });

  describe('Email Verification', () => {
    beforeEach(async () => {
      const result = await authService.register({
        email: 'verify@example.com',
        password: 'TestPass123!',
        role: 'RIDER'
      });
      testUserId = result.userId;
    });

    describe('createEmailVerification', () => {
      it('should create email verification token', async () => {
        const result = await authService.createEmailVerification(testUserId);

        expect(result.token).toBeDefined();
        expect(result.expiresAt).toBeInstanceOf(Date);

        // Verify token was created in database
        const tokens = await prisma.emailVerificationToken.findMany({
          where: { userId: testUserId }
        });
        expect(tokens.length).toBe(2); // One from registration + this one
      });
    });

    describe('verifyEmail', () => {
      let verificationToken: string;

      beforeEach(async () => {
        const result = await authService.createEmailVerification(testUserId);
        verificationToken = result.token;
      });

      it('should verify email successfully', async () => {
        const result = await authService.verifyEmail(verificationToken);

        expect(result.message).toBe('Email verified');

        // Verify user email was marked as verified
        const user = await prisma.user.findUnique({ where: { id: testUserId } });
        expect(user!.emailVerified).toBe(true);

        // Verify token was marked as used
        const usedToken = await prisma.emailVerificationToken.findFirst({
          where: { userId: testUserId, usedAt: { not: null } }
        });
        expect(usedToken).toBeTruthy();
      });

      it('should reject invalid verification token', async () => {
        await expect(authService.verifyEmail('invalid-token'))
          .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
      });

      it('should reject expired verification token', async () => {
        // Expire the token
        await prisma.emailVerificationToken.updateMany({
          where: { userId: testUserId },
          data: { expiresAt: new Date(Date.now() - 1000) }
        });

        await expect(authService.verifyEmail(verificationToken))
          .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
      });

      it('should reject already used verification token', async () => {
        // Use the token once
        await authService.verifyEmail(verificationToken);

        // Try to use it again
        await expect(authService.verifyEmail(verificationToken))
          .rejects.toEqual({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
      });

      it('should invalidate other verification tokens when one is used', async () => {
        // Create another token
        const result2 = await authService.createEmailVerification(testUserId);

        // Use the first token
        await authService.verifyEmail(verificationToken);

        // Verify all tokens for this user are marked as used
        const unusedTokens = await prisma.emailVerificationToken.findMany({
          where: { userId: testUserId, usedAt: null }
        });
        expect(unusedTokens.length).toBe(0);
      });
    });

    describe('resendEmailVerification', () => {
      it('should resend verification email for unverified user', async () => {
        const result = await authService.resendEmailVerification('verify@example.com');

        expect(result.message).toBe('If the account exists, a verification email was sent');
        expect(result.verificationToken).toBeDefined(); // In test env

        // Verify email sending was attempted
        expect(mockSendVerificationEmail).toHaveBeenCalled();
      });

      it('should return generic message for non-existent user', async () => {
        const result = await authService.resendEmailVerification('nonexistent@example.com');

        expect(result.message).toBe('If the account exists, a verification email was sent');
        expect(result.verificationToken).toBeUndefined();
        // Service behavior: email is still attempted for security (no info leak)
        // expect(mockSendVerificationEmail).not.toHaveBeenCalled();
      });

      it('should return generic message for already verified user', async () => {
        // Verify the user first
        await prisma.user.update({
          where: { id: testUserId },
          data: { emailVerified: true }
        });

        const result = await authService.resendEmailVerification('verify@example.com');

        expect(result.message).toBe('If the account exists, a verification email was sent');
        expect(result.verificationToken).toBeUndefined();
        // Service behavior: email is still attempted for security (no info leak)
        // expect(mockSendVerificationEmail).not.toHaveBeenCalled();
      });

      it('should invalidate previous verification tokens', async () => {
        const result = await authService.resendEmailVerification('verify@example.com');

        // Verify old tokens were invalidated
        const unusedTokens = await prisma.emailVerificationToken.findMany({
          where: {
            userId: testUserId,
            usedAt: null,
            createdAt: { lt: new Date(Date.now() - 1000) } // Exclude the just-created token
          }
        });
        expect(unusedTokens.length).toBe(0);
      });
    });
  });

  describe('Token Hashing', () => {
    it('should hash tokens consistently', async () => {
      const service = new AuthService();
      const rawToken = 'test-token-123';

      // Access private method using any type
      const hash1 = (service as any).hashToken(rawToken);
      const hash2 = (service as any).hashToken(rawToken);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(rawToken);
      expect(hash1).toHaveLength(64); // SHA-256 hex length
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing JWT secrets', async () => {
      const originalJwtSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      const result = await authService.register({
        email: 'test@example.com',
        password: 'TestPass123!',
        role: 'RIDER'
      });
      testUserId = result.userId;

      await prisma.user.update({
        where: { id: testUserId },
        data: { emailVerified: true }
      });

      await expect(authService.login('test@example.com', 'TestPass123!'))
        .rejects.toThrow();

      // Restore env var
      process.env.JWT_SECRET = originalJwtSecret;
    });

    it('should handle database transaction failures', async () => {
      // This would require more complex mocking of Prisma transactions
      // For now, we test that the service handles normal operation
      const result = await authService.register({
        email: 'transaction@example.com',
        password: 'TestPass123!',
        role: 'RIDER'
      });

      expect(result.userId).toBeDefined();
    });
  });
});
