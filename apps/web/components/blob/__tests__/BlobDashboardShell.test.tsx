import { render, screen } from '@testing-library/react';
import { Home, MessageSquare } from 'lucide-react';
import { BlobDashboardShell } from '../BlobDashboardShell';

describe('BlobDashboardShell', () => {
  it('expose une navigation mobile avec zones tactiles confortables', () => {
    render(
      <BlobDashboardShell
        title="Espace test"
        nav={[
          { label: 'Accueil', href: '/dashboard', icon: <Home size={16} /> },
          { label: 'Messages', href: '/messages', icon: <MessageSquare size={16} /> },
        ]}
      >
        <p>Contenu</p>
      </BlobDashboardShell>,
    );

    const accueilLinks = screen.getAllByRole('link', { name: /accueil/i });
    expect(accueilLinks.some((link) => link.className.includes('min-h-10'))).toBe(true);
    expect(screen.getByRole('heading', { name: 'Espace test' })).toHaveClass('break-words');
  });
});
