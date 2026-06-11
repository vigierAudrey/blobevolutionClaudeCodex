import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';

import SecurityHallOfFamePage from '../security-hall-of-fame/page';
import SecurityPolicyPage from '../security-policy/page';

const SECURITY_EMAIL = 'security@blobsurf.com';
const PLACEHOLDER_EMAIL = ['METTRE_EMAIL', 'SECURITE', 'ICI', 'AVANT', 'PROD'].join('_');
const LEGACY_SECURITY_DOMAIN = ['blobinfini', 'fr'].join('.');

const securitySurfaceFiles = [
  path.resolve(__dirname, '../..', 'public/.well-known/security.txt'),
  path.resolve(__dirname, '../security-policy/page.tsx'),
  path.resolve(__dirname, '../security-hall-of-fame/page.tsx'),
];

const readSecuritySurfaces = () =>
  securitySurfaceFiles.map((filePath) => ({
    filePath,
    content: fs.readFileSync(filePath, 'utf8'),
  }));

describe('public security surfaces', () => {
  it('publishes the official security contact in security.txt', () => {
    const securityTxt = fs.readFileSync(securitySurfaceFiles[0], 'utf8');

    expect(securityTxt).toContain(`Contact: mailto:${SECURITY_EMAIL}`);
    expect(securityTxt).toContain('Canonical: https://blobsurf.com/.well-known/security.txt');
    expect(securityTxt).toContain('Policy: https://blobsurf.com/security-policy');
    expect(securityTxt).toContain('Acknowledgments: https://blobsurf.com/security-hall-of-fame');
    expect(securityTxt).not.toContain(PLACEHOLDER_EMAIL);
    expect(securityTxt).not.toContain(LEGACY_SECURITY_DOMAIN);
  });

  it('keeps placeholder, legacy domain, and personal emails out of public security surfaces', () => {
    const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

    for (const { content } of readSecuritySurfaces()) {
      expect(content).not.toContain(PLACEHOLDER_EMAIL);
      expect(content).not.toContain(LEGACY_SECURITY_DOMAIN);

      const emails = content.match(emailPattern) ?? [];
      expect(new Set(emails)).toEqual(new Set([SECURITY_EMAIL]));
    }
  });

  it('shows the official security contact on the security policy page', () => {
    render(<SecurityPolicyPage />);

    expect(screen.getAllByText(SECURITY_EMAIL).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('link', { name: SECURITY_EMAIL }).some((link) =>
        link.getAttribute('href') === `mailto:${SECURITY_EMAIL}`,
      ),
    ).toBe(true);
  });

  it('shows the official security contact on the hall of fame page without bounty promises', () => {
    render(<SecurityHallOfFamePage />);

    expect(screen.getAllByText(SECURITY_EMAIL).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('link', { name: SECURITY_EMAIL }).some((link) =>
        link.getAttribute('href') === `mailto:${SECURITY_EMAIL}`,
      ),
    ).toBe(true);
    expect(screen.queryByText(new RegExp('bug\\s+bounty', 'i'))).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp('récom' + 'pense', 'i'))).not.toBeInTheDocument();
  });
});
