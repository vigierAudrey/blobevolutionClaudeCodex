import { buildAccountDeletionCancellationEmail, buildAccountDeletionEmail } from '../mailer';

describe('Account deletion mailer helpers', () => {
  const originalWebBaseUrl = process.env.WEB_BASE_URL;

  beforeEach(() => {
    process.env.WEB_BASE_URL = 'http://localhost:3002';
  });

  afterEach(() => {
    process.env.WEB_BASE_URL = originalWebBaseUrl;
  });

  it('builds deletion scheduling email for rider with profile CTA', () => {
    const deletionDate = new Date('2025-01-20T12:00:00Z');

    const mail = buildAccountDeletionEmail('rider@example.com', deletionDate, 'RIDER');

    expect(mail).toMatchObject({
      to: 'rider@example.com',
      subject: '🗑️ Suppression de compte programmée',
    });
    expect(mail.text).toContain('2025-01-20');
    expect(mail.html).toContain('http://localhost:3002/profile');
  });

  it('builds cancellation email for pros with dashboard CTA', () => {
    const mail = buildAccountDeletionCancellationEmail('pro@example.com', 'PRO');

    expect(mail).toMatchObject({
      to: 'pro@example.com',
      subject: '✅ Suppression de compte annulée',
    });
    expect(mail.html).toContain('http://localhost:3002/pro/profile');
  });
});
