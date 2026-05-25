import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('Admin analytics — libelles ContactRequest', () => {
  it('ne parle plus de booking accepte dans les analytics admin et les traductions marketplace', () => {
    const files = [
      join(root, 'app/admin/analytics/page.tsx'),
      join(root, 'messages/fr.json'),
      join(root, 'messages/en.json'),
      join(root, 'messages/es.json'),
      join(root, 'messages/de.json'),
      join(root, 'messages/nl.json'),
    ];

    const content = files.map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(content).toContain('Taux de sollicitation pro');
    expect(content).toContain('Taux de mise en relation');
    expect(content).toContain('Conversations démarrées');
    expect(content).toContain('Taux mise en relation → conversation');
    expect(content).not.toMatch(/Accepted bookings|Bookings acceptés|Reservas aceptadas|Angenommene Buchungen|Geaccepteerde boekingen/i);
    expect(content).not.toMatch(/cours accepté|réservation acceptée/i);
  });
});
