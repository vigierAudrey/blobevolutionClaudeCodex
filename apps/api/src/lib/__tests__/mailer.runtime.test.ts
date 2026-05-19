import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreateTransport = jest.fn();
const mockSendMail = jest.fn();
const mockVerify = jest.fn();
const loggerError = jest.fn();
const loggerInfo = jest.fn();
const loggerWarn = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: mockCreateTransport,
  },
}));

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    error: loggerError,
    info: loggerInfo,
    warn: loggerWarn,
  },
}));

describe('mailer runtime hardening', () => {
  const originalEnv = process.env;
  let mailer: typeof import('../mailer');

  beforeAll(() => {
    mailer = jest.requireActual('../mailer') as typeof import('../mailer');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      APP_ENV: 'vps',
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_PORT: '587',
      SMTP_USER: 'brevo-user',
      SMTP_PASS: 'brevo-pass',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'no-reply@example.com',
      EMAIL_HASH_SECRET: 'e'.repeat(32),
    };
    mockSendMail.mockResolvedValue({ messageId: 'msg-1' });
    mockVerify.mockResolvedValue(true);
    mockCreateTransport.mockReturnValue({
      sendMail: mockSendMail,
      verify: mockVerify,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('configure explicit SMTP timeouts and strict TLS in VPS', async () => {
    await mailer.sendVerificationEmail('user@example.com', 'token-1234567890');

    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 5000,
      tls: expect.objectContaining({
        servername: 'smtp-relay.brevo.com',
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      }),
    }));
  });

  it('throws MailDeliveryError on SMTP failure and never logs secrets', async () => {
    mockSendMail.mockRejectedValue(Object.assign(new Error('Invalid login brevo-pass smtp-relay.brevo.com'), {
      responseCode: 535,
      code: 'EAUTH',
    }));

    await expect(mailer.sendVerificationEmail('user@example.com', 'token-1234567890'))
      .rejects
      .toMatchObject({
        name: 'MailDeliveryError',
        message: 'Email delivery unavailable',
        smtpCode: 535,
      });

    expect(loggerError).toHaveBeenCalledWith(
      'EMAIL_SEND_FAILED',
      expect.objectContaining({
        provider: 'brevo',
        type: 'email_verification',
        smtpCode: 535,
      }),
    );
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain('brevo-pass');
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain('smtp-relay.brevo.com');
  });

  it('logs EMAIL_SEND_TIMEOUT when transport times out', async () => {
    mockSendMail.mockRejectedValue(Object.assign(new Error('socket timeout'), {
      code: 'ETIMEDOUT',
    }));

    await expect(mailer.sendPasswordResetEmail('user@example.com', 'token-1234567890'))
      .rejects
      .toMatchObject({
        name: 'MailDeliveryError',
        message: 'Email delivery unavailable',
      });

    expect(loggerError).toHaveBeenCalledWith(
      'EMAIL_SEND_TIMEOUT',
      expect.objectContaining({
        provider: 'brevo',
        type: 'password_reset',
      }),
    );
  });

  it('exposes a bounded SMTP verify probe for health checks', async () => {
    await expect(mailer.verifySmtpConnection()).resolves.toBe(true);
    expect(mockVerify).toHaveBeenCalledTimes(1);
  });
});
