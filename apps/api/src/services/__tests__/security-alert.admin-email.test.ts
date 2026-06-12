/**
 * Garde-fou : le destinataire des alertes sécurité ne doit JAMAIS retomber
 * sur un domaine legacy blobinfini.* (domaines terminés). Sans ADMIN_EMAIL,
 * le fallback doit être la boîte sécurité canonique security@blobsurf.com.
 */

jest.mock('../../lib/mailer', () => ({
  sendMail: jest.fn().mockResolvedValue({ sent: true }),
}));

jest.mock('../system-alert.service', () => ({
  systemAlertService: { createAlert: jest.fn().mockResolvedValue(undefined) },
}));

describe('SecurityAlertService — destinataire admin', () => {
  const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL;

  afterEach(() => {
    if (ORIGINAL_ADMIN_EMAIL === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL;
    }
    jest.resetModules();
    jest.clearAllMocks();
  });

  const reportViolation = async () => {
    let sendMailMock: jest.Mock = jest.fn();
    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(() => {
        const { sendMail } = require('../../lib/mailer');
        sendMailMock = sendMail as jest.Mock;
        const { securityAlertService } = require('../security-alert.service');
        securityAlertService
          .reportSecurityViolation({
            userId: 'user-1',
            userRole: 'RIDER',
            action: 'TEST',
            endpoint: '/pro/me',
            attemptedAction: 'test',
          })
          .then(resolve, reject);
      });
    });
    return sendMailMock;
  };

  it('sans ADMIN_EMAIL, utilise le fallback security@blobsurf.com', async () => {
    delete process.env.ADMIN_EMAIL;
    const sendMail = await reportViolation();

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('security@blobsurf.com');
  });

  it('ne retombe jamais sur un domaine legacy blobinfini', async () => {
    delete process.env.ADMIN_EMAIL;
    const sendMail = await reportViolation();

    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).not.toContain('blobinfini');
  });

  it('respecte ADMIN_EMAIL quand il est défini', async () => {
    process.env.ADMIN_EMAIL = 'ops-security@blobsurf.com';
    const sendMail = await reportViolation();

    expect(sendMail.mock.calls[0][0].to).toBe('ops-security@blobsurf.com');
  });
});
