import { clientPrisma as prisma } from '@blobinfini/database';
import { systemAlertService } from '../system-alert.service';

// ── helpers ────────────────────────────────────────────────────────────────

async function deleteTestAlerts() {
  await prisma.systemAlert.deleteMany({
    where: { type: { startsWith: 'TEST_OCCURRENCE_' } }
  });
}

// ── suite ──────────────────────────────────────────────────────────────────

describe('SystemAlertService — occurrence tracking (F12)', () => {
  beforeEach(deleteTestAlerts);
  afterAll(deleteTestAlerts);

  it('createAlert initialise occurrenceCount=1, firstSeenAt, lastSeenAt', async () => {
    const before = new Date();
    const alert = await systemAlertService.createAlert({
      type: 'TEST_OCCURRENCE_CREATE',
      message: 'msg',
      severity: 'INFO'
    });

    expect(alert.occurrenceCount).toBe(1);
    expect(alert.firstSeenAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(alert.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    // firstSeenAt ≈ lastSeenAt on first creation
    expect(Math.abs(alert.firstSeenAt.getTime() - alert.lastSeenAt.getTime())).toBeLessThan(50);
  });

  it('ensureAlert crée avec occurrenceCount=1 si aucun doublon', async () => {
    const alert = await systemAlertService.ensureAlert({
      type: 'TEST_OCCURRENCE_ENSURE_NEW',
      message: 'msg',
      dedupeKey: 'test-key-new'
    });

    expect(alert.occurrenceCount).toBe(1);
    expect(alert.firstSeenAt).toBeTruthy();
    expect(alert.lastSeenAt).toBeTruthy();
  });

  it('ensureAlert incrémente occurrenceCount et met à jour lastSeenAt sans toucher firstSeenAt', async () => {
    // Création initiale
    const first = await systemAlertService.ensureAlert({
      type: 'TEST_OCCURRENCE_DEDUP',
      message: 'msg',
      severity: 'WARNING',
      dedupeKey: 'test-dedup-key'
    });
    expect(first.occurrenceCount).toBe(1);
    const originalFirstSeenAt = first.firstSeenAt.getTime();

    // Attendre 1ms pour s'assurer que lastSeenAt sera différent
    await new Promise(r => setTimeout(r, 2));

    // Deuxième appel — même type + dedupeKey, alerte OPEN → déduplication
    const second = await systemAlertService.ensureAlert({
      type: 'TEST_OCCURRENCE_DEDUP',
      message: 'msg',
      severity: 'WARNING',
      dedupeKey: 'test-dedup-key'
    });

    expect(second.id).toBe(first.id);                    // même ligne
    expect(second.occurrenceCount).toBe(2);              // compteur incrémenté
    expect(second.firstSeenAt.getTime()).toBe(originalFirstSeenAt); // inchangé
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(originalFirstSeenAt); // mis à jour
  });

  it('ensureAlert incrémente à nouveau au troisième appel', async () => {
    const key = 'test-dedup-triple';
    await systemAlertService.ensureAlert({ type: 'TEST_OCCURRENCE_TRIPLE', message: 'msg', dedupeKey: key });
    await systemAlertService.ensureAlert({ type: 'TEST_OCCURRENCE_TRIPLE', message: 'msg', dedupeKey: key });
    const third = await systemAlertService.ensureAlert({ type: 'TEST_OCCURRENCE_TRIPLE', message: 'msg', dedupeKey: key });

    expect(third.occurrenceCount).toBe(3);
  });

  it('une alerte résolue puis recréée repart de occurrenceCount=1', async () => {
    const key = 'test-dedup-resolved';
    const original = await systemAlertService.ensureAlert({
      type: 'TEST_OCCURRENCE_RESOLVED',
      message: 'msg',
      dedupeKey: key
    });
    // Résoudre
    await systemAlertService.resolve(original.id);

    // Recréer — l'alerte résolue n'est plus OPEN/ACKNOWLEDGED, donc nouvelle ligne
    const recreated = await systemAlertService.ensureAlert({
      type: 'TEST_OCCURRENCE_RESOLVED',
      message: 'msg',
      dedupeKey: key
    });

    expect(recreated.id).not.toBe(original.id);  // nouvelle ligne
    expect(recreated.occurrenceCount).toBe(1);   // compteur remis à zéro
    expect(recreated.status).toBe('OPEN');
  });

  it('ensureAlert ne déduplique pas si dedupeKey différente', async () => {
    const a = await systemAlertService.ensureAlert({
      type: 'TEST_OCCURRENCE_NODUP',
      message: 'msg',
      dedupeKey: 'key-a'
    });
    const b = await systemAlertService.ensureAlert({
      type: 'TEST_OCCURRENCE_NODUP',
      message: 'msg',
      dedupeKey: 'key-b'
    });

    expect(a.id).not.toBe(b.id);
    expect(a.occurrenceCount).toBe(1);
    expect(b.occurrenceCount).toBe(1);
  });
});
