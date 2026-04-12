import {
  clientPrisma as prisma,
  Role,
} from '@blobinfini/database';
import { createUser } from '../../tests/helpers/prismaFactories';
import { retentionExportArtifactService } from '../retention-export-artifact.service';

const TEST_TAG = 'retention-artifact';

async function cleanup() {
  await prisma.retentionExportArtifact.deleteMany({
    where: {
      createdByAdmin: { email: { contains: TEST_TAG } },
    },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: TEST_TAG } },
  });
}

describe('RetentionExportArtifactService', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('creates, marks ready, verifies and lists manifests', async () => {
    const admin = await createUser(prisma, {
      email: `${TEST_TAG}-${Date.now()}@test.local`,
      role: Role.ADMIN,
      emailVerified: true,
    });

    const created = await retentionExportArtifactService.createArtifact({
      scope: 'AUDIT_LOG',
      fromDate: new Date('2025-01-01T00:00:00.000Z'),
      toDate: new Date('2025-12-31T23:59:59.999Z'),
      createdByAdminId: admin.id,
    });

    const ready = await retentionExportArtifactService.markReady({
      artifactId: created.id,
      payload: '{"ok":true}\n',
      rowCount: 1,
      storageKey: 'tmp/test.ndjson',
    });
    const verified = await retentionExportArtifactService.verifyArtifact(created.id);
    const list = await retentionExportArtifactService.listArtifacts({
      page: 1,
      limit: 10,
      status: 'VERIFIED',
    });
    const hasCoverage = await retentionExportArtifactService.hasVerifiedCoverage(
      'AUDIT_LOG',
      new Date('2025-01-01T00:00:00.000Z'),
      new Date('2025-12-31T00:00:00.000Z'),
    );

    expect(ready.status).toBe('READY');
    expect(ready.sha256).toHaveLength(64);
    expect(verified.status).toBe('VERIFIED');
    expect(verified.verifiedAt).toBeTruthy();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.createdByAdmin.email).toBe(admin.email);
    expect(hasCoverage).toBe(true);
  });
});
