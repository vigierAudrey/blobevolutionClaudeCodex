import { clientPrisma as prisma, Prisma } from '@blobinfini/database';

type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
type Status = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

interface CreateAlertInput {
  type: string;
  message: string;
  severity?: Severity;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
  createdById?: string | null;
  dedupeKey?: string | null;
}

interface EnsureAlertInput extends CreateAlertInput {
  dedupeKey?: string;
}

class SystemAlertService {
  async list(params: {
    status?: Status;
    severity?: Severity;
    limit?: number;
    page?: number;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.severity) where.severity = params.severity;

    const [items, total] = await Promise.all([
      prisma.systemAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          createdBy: {
            select: { id: true, email: true }
          }
        }
      }),
      prisma.systemAlert.count({ where })
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async createAlert(input: CreateAlertInput) {
    const metadataValue: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined =
      input.metadata === undefined
        ? undefined
        : input.metadata === null
          ? Prisma.JsonNull
          : (input.metadata as Prisma.InputJsonValue);

    const alert = await prisma.systemAlert.create({
      data: {
        type: input.type,
        message: input.message,
        severity: input.severity ?? 'INFO',
        status: 'OPEN',
        link: input.link ?? null,
        metadata: metadataValue,
        dedupeKey: input.dedupeKey ?? null,
        createdById: input.createdById ?? null
      }
    });
    return alert;
  }

  async ensureAlert(input: EnsureAlertInput) {
    const dedupeKey = input.dedupeKey ?? `${input.type}:${input.message}`;
    const existing = await prisma.systemAlert.findFirst({
      where: {
        type: input.type,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        dedupeKey
      }
    });

    if (existing) {
      return existing;
    }

    const metadataValue: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined =
      input.metadata === undefined
        ? undefined
        : input.metadata === null
          ? Prisma.JsonNull
          : (input.metadata as Prisma.InputJsonValue);

    return prisma.systemAlert.create({
      data: {
        type: input.type,
        message: input.message,
        severity: input.severity ?? 'INFO',
        status: 'OPEN',
        link: input.link ?? null,
        metadata: metadataValue,
        dedupeKey,
        createdById: input.createdById ?? null
      }
    });
  }

  async acknowledge(id: string) {
    return prisma.systemAlert.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date()
      }
    });
  }

  async resolve(id: string) {
    return prisma.systemAlert.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date()
      }
    });
  }
}

export const systemAlertService = new SystemAlertService();
