import crypto from 'crypto';
import { clientPrisma as prisma } from '@blobinfini/database';

type ExportFormat = 'NDJSON';
type ExportScope = 'AUDIT_LOG';
type ExportStatus = 'GENERATING' | 'READY' | 'VERIFIED' | 'FAILED' | 'EXPIRED';

type CreateRetentionExportArtifactInput = {
  scope: ExportScope;
  fromDate: Date;
  toDate: Date;
  createdByAdminId: string;
  format?: ExportFormat;
};

type MarkArtifactReadyInput = {
  artifactId: string;
  rowCount: number;
  payload: string;
  storageKey?: string | null;
};

export class RetentionExportArtifactService {
  async createArtifact(input: CreateRetentionExportArtifactInput) {
    return prisma.retentionExportArtifact.create({
      data: {
        scope: input.scope,
        format: input.format ?? 'NDJSON',
        fromDate: input.fromDate,
        toDate: input.toDate,
        createdByAdminId: input.createdByAdminId,
      },
    });
  }

  async markReady(input: MarkArtifactReadyInput) {
    const sha256 = crypto.createHash('sha256').update(input.payload).digest('hex');

    return prisma.retentionExportArtifact.update({
      where: { id: input.artifactId },
      data: {
        rowCount: input.rowCount,
        sha256,
        storageKey: input.storageKey ?? null,
        status: 'READY',
      },
    });
  }

  async verifyArtifact(artifactId: string) {
    return prisma.retentionExportArtifact.update({
      where: { id: artifactId },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });
  }

  async markFailed(artifactId: string, error: string) {
    return prisma.retentionExportArtifact.update({
      where: { id: artifactId },
      data: {
        status: 'FAILED',
        error,
      },
    });
  }

  async listArtifacts(params: {
    page: number;
    limit: number;
    scope?: ExportScope;
    status?: ExportStatus;
    createdByAdminId?: string;
  }) {
    const where = {
      ...(params.scope ? { scope: params.scope } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.createdByAdminId ? { createdByAdminId: params.createdByAdminId } : {}),
    };

    const skip = (params.page - 1) * params.limit;
    const [items, total] = await Promise.all([
      prisma.retentionExportArtifact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
        include: {
          createdByAdmin: {
            select: {
              id: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      prisma.retentionExportArtifact.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }

  async hasVerifiedCoverage(scope: ExportScope, fromDate: Date, toDate: Date): Promise<boolean> {
    const artifact = await prisma.retentionExportArtifact.findFirst({
      where: {
        scope,
        status: 'VERIFIED',
        fromDate: { lte: fromDate },
        toDate: { gte: toDate },
      },
      orderBy: { toDate: 'desc' },
      select: { id: true },
    });

    return Boolean(artifact);
  }
}

export const retentionExportArtifactService = new RetentionExportArtifactService();
