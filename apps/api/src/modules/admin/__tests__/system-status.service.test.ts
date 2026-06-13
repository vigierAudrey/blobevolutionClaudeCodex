/**
 * Tests unitaires du service "État système" (GAP-2).
 * Fonctions pures + agrégation à dépendances injectées — sans réseau ni DB.
 */
import {
  evaluateBackupState,
  evaluateDisk,
  resolveVersion,
  humanBytes,
  buildSystemStatus,
} from '../system-status.service';

describe('evaluateBackupState', () => {
  const NOW = new Date('2026-06-13T12:00:00.000Z');
  const thresholds = { warnHours: 26, criticalHours: 50 };

  it('fichier absent → unknown / warn', () => {
    const r = evaluateBackupState(null, NOW, thresholds);
    expect(r.state).toBe('unknown');
    expect(r.health).toBe('warn');
    expect(r.lastBackupAt).toBeNull();
  });

  it('JSON invalide (schéma) → unknown / warn, sans crash', () => {
    const r = evaluateBackupState({ foo: 'bar' }, NOW, thresholds);
    expect(r.state).toBe('unknown');
    expect(r.health).toBe('warn');
  });

  it('horodatage invalide → unknown', () => {
    const r = evaluateBackupState({ status: 'ok', timestamp: 'not-a-date' }, NOW, thresholds);
    expect(r.state).toBe('unknown');
  });

  it('backup récent valide → ok / ok', () => {
    const r = evaluateBackupState(
      { status: 'ok', timestamp: '2026-06-13T11:00:00.000Z', sizeBytes: 2048, sha256: 'a'.repeat(64), durationMs: 1500 },
      NOW,
      thresholds,
    );
    expect(r.state).toBe('ok');
    expect(r.health).toBe('ok');
    expect(r.ageSeconds).toBe(3600);
    expect(r.sizeBytes).toBe(2048);
    expect(r.hasChecksum).toBe(true);
    expect(r.sizeHuman).toBe('2.0 KB');
  });

  it('backup vieillissant (> warn, < critical) → warn', () => {
    const r = evaluateBackupState(
      { status: 'ok', timestamp: '2026-06-12T06:00:00.000Z' }, // 30 h
      NOW,
      thresholds,
    );
    expect(r.health).toBe('warn');
  });

  it('backup trop ancien (> critical) → critical', () => {
    const r = evaluateBackupState(
      { status: 'ok', timestamp: '2026-06-10T06:00:00.000Z' }, // ~78 h
      NOW,
      thresholds,
    );
    expect(r.health).toBe('critical');
  });

  it('status failed → failed / critical avec errorCode', () => {
    const r = evaluateBackupState(
      { status: 'failed', timestamp: '2026-06-13T11:00:00.000Z', errorCode: 'BACKUP_FAILED' },
      NOW,
      thresholds,
    );
    expect(r.state).toBe('failed');
    expect(r.health).toBe('critical');
    expect(r.errorCode).toBe('BACKUP_FAILED');
  });

  it('anti-fuite : un filename avec chemin est réduit au basename', () => {
    const r = evaluateBackupState(
      { status: 'ok', timestamp: '2026-06-13T11:00:00.000Z', filename: '/var/backups/blob/secret_path/dump.sql.gz' },
      NOW,
      thresholds,
    );
    expect(r.filename).toBe('dump.sql.gz');
    expect(r.filename).not.toContain('/');
  });

  it('un champ inattendu (ex: chemin/secret) n\'apparaît jamais dans la sortie', () => {
    const r = evaluateBackupState(
      { status: 'ok', timestamp: '2026-06-13T11:00:00.000Z', password: 'hunter2', absolutePath: '/etc/secret' } as unknown,
      NOW,
      thresholds,
    );
    const serialized = JSON.stringify(r);
    expect(serialized).not.toMatch(/hunter2/);
    expect(serialized).not.toMatch(/\/etc\/secret/);
  });
});

describe('evaluateDisk', () => {
  const thresholds = { warnPercent: 80, criticalPercent: 90 };
  const mk = (usedFraction: number) => {
    const blocks = 1000;
    const bfree = Math.round(blocks * (1 - usedFraction));
    return { bsize: 4096, blocks, bfree };
  };

  it('mesure indisponible → unknown', () => {
    const r = evaluateDisk(null, thresholds);
    expect(r.health).toBe('unknown');
    expect(r.usedPercent).toBeNull();
  });

  it('usage faible → ok', () => {
    const r = evaluateDisk(mk(0.5), thresholds);
    expect(r.health).toBe('ok');
    expect(r.usedPercent).toBe(50);
    expect(r.totalBytes).toBe(1000 * 4096);
  });

  it('usage 85% → warn', () => {
    const r = evaluateDisk(mk(0.85), thresholds);
    expect(r.health).toBe('warn');
    expect(r.usedPercent).toBe(85);
  });

  it('usage 95% → critical', () => {
    const r = evaluateDisk(mk(0.95), thresholds);
    expect(r.health).toBe('critical');
  });

  it('blocks invalides → unknown', () => {
    expect(evaluateDisk({ bsize: 4096, blocks: 0, bfree: 0 }, thresholds).health).toBe('unknown');
  });
});

describe('resolveVersion', () => {
  const save = { ...process.env };
  afterEach(() => {
    process.env.GIT_COMMIT_SHA = save.GIT_COMMIT_SHA;
    process.env.COMMIT_SHA = save.COMMIT_SHA;
    process.env.DEPLOY_TIMESTAMP = save.DEPLOY_TIMESTAMP;
  });

  it('SHA présent → court (7 car)', () => {
    process.env.GIT_COMMIT_SHA = '1a2b3c4d5e6f7081920';
    expect(resolveVersion().commit).toBe('1a2b3c4');
  });

  it('SHA absent → unknown', () => {
    delete process.env.GIT_COMMIT_SHA;
    delete process.env.COMMIT_SHA;
    expect(resolveVersion().commit).toBe('unknown');
  });

  it('SHA non hexadécimal → unknown (anti-injection)', () => {
    process.env.GIT_COMMIT_SHA = 'not-a-sha; rm -rf /';
    expect(resolveVersion().commit).toBe('unknown');
  });

  it('DEPLOY_TIMESTAMP valide → ISO', () => {
    process.env.GIT_COMMIT_SHA = 'abcdef1';
    process.env.DEPLOY_TIMESTAMP = '2026-06-13T10:00:00Z';
    expect(resolveVersion().deployedAt).toBe('2026-06-13T10:00:00.000Z');
  });
});

describe('humanBytes', () => {
  it('formate les tailles', () => {
    expect(humanBytes(0)).toBe('0 B');
    expect(humanBytes(2048)).toBe('2.0 KB');
    expect(humanBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(humanBytes(null)).toBeNull();
    expect(humanBytes(-1)).toBeNull();
  });
});

describe('buildSystemStatus (deps injectées)', () => {
  it('agrège tous les blocs et expose uniquement les clés attendues', async () => {
    const res = await buildSystemStatus({
      now: () => new Date('2026-06-13T12:00:00.000Z'),
      readiness: async () => ({
        status: 'ok',
        checks: { database: 'ok', redis: 'ok', storage: 'not_configured' },
        timestamp: '2026-06-13T12:00:00.000Z',
      }),
      backupRaw: async () => ({ status: 'ok', timestamp: '2026-06-13T11:30:00.000Z', sizeBytes: 1024 }),
      disk: async () => ({ health: 'ok', usedPercent: 42, totalBytes: 100, freeBytes: 58, message: 'ok' }),
      alerts: async () => ({ open: 3, criticalOpen: 1 }),
    });

    expect(Object.keys(res).sort()).toEqual(['alerts', 'backup', 'disk', 'generatedAt', 'readiness', 'version']);
    expect(res.generatedAt).toBe('2026-06-13T12:00:00.000Z');
    expect(res.backup.health).toBe('ok');
    expect(res.disk.usedPercent).toBe(42);
    expect(res.alerts).toEqual({ open: 3, criticalOpen: 1 });
    expect(res.readiness.checks.database).toBe('ok');
  });
});
