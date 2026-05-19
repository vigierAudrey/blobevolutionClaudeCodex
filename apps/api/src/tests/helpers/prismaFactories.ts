import { Role, Prisma } from '@blobinfini/database';
import type { PrismaClient } from '@blobinfini/database';
import bcrypt from 'bcryptjs';

type UserCreateInput = Prisma.UserCreateArgs['data'];
type RiderProfileOverrides = Omit<Prisma.RiderProfileUncheckedCreateInput, 'userId'>;
type ProProfileOverrides = Omit<Prisma.ProProfileUncheckedCreateInput, 'userId'>;

const DEFAULT_PASSWORD = 'Passw0rd!';

const randomEmail = (prefix: string) =>
  `${prefix}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

const CONSENT_VERSION = 'v1.0.0';

export async function createUser(
  prisma: PrismaClient,
  overrides: Partial<UserCreateInput> = {},
  opts: { rawPassword?: string } = {},
) {
  const { email, password, role, consentedAt, consentVersion, ...rest } = overrides;

  const hashedPassword =
    password ?? (await bcrypt.hash(opts.rawPassword ?? DEFAULT_PASSWORD, 12));

  const data: UserCreateInput = {
    email: email ?? randomEmail('user'),
    password: hashedPassword,
    role: (role as Role | undefined) ?? Role.RIDER,
    consentedAt: consentedAt ?? new Date(),
    consentVersion: consentVersion ?? CONSENT_VERSION,
    ...rest,
  };

  return prisma.user.create({ data });
}

type EnsureProfileBaseOptions<TProfile> = {
  userId?: string | null;
  profile?: TProfile;
  userOverrides?: Partial<UserCreateInput>;
};

export async function ensureRiderProfile(
  prisma: PrismaClient,
  options: EnsureProfileBaseOptions<RiderProfileOverrides> = {},
) {
  const { userId, profile, userOverrides } = options;

  const targetUserId =
    userId ??
    (
      await createUser(prisma, {
        role: Role.RIDER,
        ...userOverrides,
      })
    ).id;

  const existing = await prisma.riderProfile.findUnique({
    where: { userId: targetUserId },
  });
  if (existing) {
    return existing;
  }

  return prisma.riderProfile.create({
    data: {
      displayName: 'Test Rider',
      ...(profile ?? {}),
      userId: targetUserId,
    },
  });
}

export async function ensureProProfile(
  prisma: PrismaClient,
  options: EnsureProfileBaseOptions<ProProfileOverrides> = {},
) {
  const { userId, profile, userOverrides } = options;

  const targetUserId =
    userId ??
    (
      await createUser(prisma, {
        role: Role.PRO,
        ...userOverrides,
      })
    ).id;

  const existing = await prisma.proProfile.findUnique({
    where: { userId: targetUserId },
  });
  if (existing) {
    return existing;
  }

  return prisma.proProfile.create({
    data: {
      businessName: 'Test Pro Business',
      countryCode: 'FR',
      ...(profile ?? {}),
      userId: targetUserId,
    },
  });
}
