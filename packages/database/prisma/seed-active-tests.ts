import 'dotenv/config';
import { resolve } from 'path';
import { PrismaClient, Role, Sport, Level, Sex, DecisionKind } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { runSeed } from './seed';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  const ok = dotenv.config({ path: resolve(__dirname, '../../../.env') });
  if (!ok?.parsed) dotenv.config({ path: resolve(__dirname, './.env') });
} catch {}

const prisma = new PrismaClient();
const TEST_PASSWORD = 'Passw0rd!';
const ACTIVE_FIXTURE_EMAILS = [
  'dev+active-rider-a@test.com',
  'dev+active-rider-b@test.com',
  'dev+active-rider-c@test.com',
  'dev+active-rider-intruder@test.com',
  'dev+active-pro@test.com',
] as const;

function assertSafeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const allowNonLocal = process.env.ALLOW_NON_LOCAL_ACTIVE_TEST_DB === '1';

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const lowered = databaseUrl.toLowerCase();
  if (/(prod|production)/.test(lowered)) {
    throw new Error('Refusing to seed a production-like database');
  }

  if (allowNonLocal) {
    return;
  }

  let hostname = '';
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('DATABASE_URL must be a valid URL');
  }

  const localHosts = new Set(['localhost', '127.0.0.1', 'postgres', 'db']);
  if (!localHosts.has(hostname)) {
    throw new Error(
      `Refusing non-local database host "${hostname}". Set ALLOW_NON_LOCAL_ACTIVE_TEST_DB=1 for an ephemeral staging database.`
    );
  }
}

async function cleanupActiveFixtures() {
  const activeUsers = await prisma.user.findMany({
    where: { email: { in: [...ACTIVE_FIXTURE_EMAILS] } },
    select: {
      id: true,
      riderProfile: { select: { id: true } },
      proProfile: { select: { id: true } },
    },
  });

  if (activeUsers.length === 0) {
    return;
  }

  const userIds = activeUsers.map((user) => user.id);
  const riderProfileIds = activeUsers
    .map((user) => user.riderProfile?.id)
    .filter((id): id is string => Boolean(id));
  const conversationIds = (
    await prisma.conversationMember.findMany({
      where: { userId: { in: userIds } },
      select: { conversationId: true },
    })
  ).map((member) => member.conversationId);

  await prisma.message.deleteMany({
    where: {
      OR: [
        { senderId: { in: userIds } },
        { conversationId: { in: conversationIds } },
      ],
    },
  });
  await prisma.conversationInvitation.deleteMany({
    where: {
      OR: [
        { invitedUserId: { in: userIds } },
        { invitedBy: { in: userIds } },
        { conversationId: { in: conversationIds } },
      ],
    },
  });
  await prisma.contactRequestResponse.deleteMany({
    where: { riderUserId: { in: userIds } },
  });
  await prisma.contactRequest.deleteMany({
    where: {
      OR: [
        { proUserId: { in: userIds } },
        { conversationId: { in: conversationIds } },
      ],
    },
  });
  await prisma.conversationMember.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { conversationId: { in: conversationIds } }] },
  });
  await prisma.conversation.deleteMany({
    where: {
      OR: [
        { id: { in: conversationIds } },
        { members: { some: { userId: { in: userIds } } } },
      ],
    },
  });
  await prisma.matchDecision.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetProfileId: { in: riderProfileIds } },
      ],
    },
  });
  await prisma.match.deleteMany({
    where: {
      OR: [
        { userOneId: { in: userIds } },
        { userTwoId: { in: userIds } },
      ],
    },
  });
  await prisma.lastSearch.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.riderDiscipline.deleteMany({ where: { profileId: { in: riderProfileIds } } });
  await prisma.proOffer.deleteMany({
    where: { proProfile: { userId: { in: userIds } } },
  });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.riderProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.proProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function upsertUser(email: string, role: Role, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: {
      password: passwordHash,
      role,
      emailVerified: true,
      deletedAt: null,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
      consentIp: '127.0.0.1',
    },
    create: {
      email,
      password: passwordHash,
      role,
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
      consentIp: '127.0.0.1',
    },
  });
}

async function main() {
  assertSafeDatabaseUrl();

  const reseed = process.argv.includes('--reseed');
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  if (reseed) {
    await runSeed(prisma);
  }

  await cleanupActiveFixtures();

  const riderA = await upsertUser(ACTIVE_FIXTURE_EMAILS[0], Role.RIDER, passwordHash);
  const riderB = await upsertUser(ACTIVE_FIXTURE_EMAILS[1], Role.RIDER, passwordHash);
  const riderC = await upsertUser(ACTIVE_FIXTURE_EMAILS[2], Role.RIDER, passwordHash);
  const intruder = await upsertUser(ACTIVE_FIXTURE_EMAILS[3], Role.RIDER, passwordHash);
  const pro = await upsertUser(ACTIVE_FIXTURE_EMAILS[4], Role.PRO, passwordHash);

  const activeLat = 50.1234;
  const activeLng = 1.2345;

  const riderAProfile = await prisma.riderProfile.create({
    data: {
      userId: riderA.id,
      displayName: 'Active Rider A',
      photoUrl: '/images/blobosphere/placeholder-surf.jpg',
      bio: 'Fixture locale pour simulation de matching et messagerie.',
      sex: Sex.UNSPECIFIED,
      maxDistanceKm: 10,
      emailNotif: false,
      wantsLesson: false,
      lat: activeLat,
      lng: activeLng,
    },
  });
  const riderBProfile = await prisma.riderProfile.create({
    data: {
      userId: riderB.id,
      displayName: 'Active Rider B',
      photoUrl: '/images/blobosphere/placeholder-kite.jpg',
      bio: 'Binome réciproque pour déclencher un match déterministe.',
      sex: Sex.UNSPECIFIED,
      maxDistanceKm: 10,
      emailNotif: false,
      wantsLesson: false,
      lat: activeLat + 0.001,
      lng: activeLng + 0.001,
    },
  });
  const intruderProfile = await prisma.riderProfile.create({
    data: {
      userId: intruder.id,
      displayName: 'Active Intruder',
      photoUrl: '/images/blobosphere/placeholder-safety.jpg',
      bio: 'Utilisateur tiers pour régression authZ.',
      sex: Sex.UNSPECIFIED,
      maxDistanceKm: 5,
      emailNotif: false,
      wantsLesson: false,
      lat: activeLat + 1,
      lng: activeLng + 1,
    },
  });
  const riderCProfile = await prisma.riderProfile.create({
    data: {
      userId: riderC.id,
      displayName: 'Active Rider C',
      photoUrl: '/images/blobosphere/placeholder-surf.jpg',
      bio: 'Troisieme rider pour isoler les scenarios de charge par utilisateur.',
      sex: Sex.UNSPECIFIED,
      maxDistanceKm: 10,
      emailNotif: false,
      wantsLesson: false,
      lat: activeLat + 0.0025,
      lng: activeLng + 0.0015,
    },
  });

  await prisma.proProfile.create({
    data: {
      userId: pro.id,
      businessName: 'Active Test Pro',
      bio: 'Professionnel local factice pour scénarios de contact.',
      verified: true,
      emailNotif: false,
      pricePerHour: 55,
      lat: activeLat + 0.002,
      lng: activeLng + 0.002,
    },
  });

  await prisma.riderDiscipline.createMany({
    data: [
      { profileId: riderAProfile.id, sport: Sport.surf, level: Level.advanced },
      { profileId: riderBProfile.id, sport: Sport.surf, level: Level.advanced },
      { profileId: riderCProfile.id, sport: Sport.surf, level: Level.advanced },
      { profileId: intruderProfile.id, sport: Sport.kitesurf, level: Level.beginner },
    ],
    skipDuplicates: true,
  });

  await prisma.lastSearch.createMany({
    data: [
      {
        userId: riderA.id,
        sport: Sport.surf,
        level: Level.advanced,
        distanceKm: 10,
        lat: activeLat,
        lng: activeLng,
        date: null,
      },
      {
        userId: riderB.id,
        sport: Sport.surf,
        level: Level.advanced,
        distanceKm: 10,
        lat: activeLat + 0.001,
        lng: activeLng + 0.001,
        date: null,
      },
      {
        userId: riderC.id,
        sport: Sport.surf,
        level: Level.advanced,
        distanceKm: 10,
        lat: activeLat + 0.0025,
        lng: activeLng + 0.0015,
        date: null,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.matchDecision.upsert({
    where: {
      actorUserId_targetProfileId: {
        actorUserId: riderB.id,
        targetProfileId: riderAProfile.id,
      },
    },
    update: {
      decision: DecisionKind.ACCEPT,
      updatedAt: new Date(),
    },
    create: {
      actorUserId: riderB.id,
      targetProfileId: riderAProfile.id,
      decision: DecisionKind.ACCEPT,
    },
  });
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
