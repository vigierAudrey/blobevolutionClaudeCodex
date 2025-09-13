import 'dotenv/config';
import { resolve } from 'path';
import { PrismaClient, Role, Sex } from '@prisma/client';
import bcrypt from 'bcrypt';

// Ensure env is loaded from repo root .env (fallback prisma/.env)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  const ok = dotenv.config({ path: resolve(__dirname, '../../../.env') });
  if (!ok?.parsed) dotenv.config({ path: resolve(__dirname, './.env') });
} catch {}

export async function runSeed(client?: PrismaClient) {
  const prisma = client ?? new PrismaClient();
  // Idempotent cleanup of dev users by tag email
  const emails = ['dev+rider@test.com', 'dev+pro@test.com', 'dev+kite@test.com'];
  await prisma.refreshToken.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.passwordResetToken.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.emailVerificationToken.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.riderDiscipline.deleteMany({ where: { profile: { user: { email: { in: emails } } } } });
  await prisma.riderProfile.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });

  const hashed = await bcrypt.hash('Passw0rd!', 12);

  // Rider user with profile
  const rider = await prisma.user.create({
    data: {
      email: 'dev+rider@test.com',
      password: hashed,
      role: Role.RIDER,
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
      consentIp: '127.0.0.1',
      riderProfile: {
        create: {
          displayName: 'Blobmama',
          bio: 'Rideuse cool, team sunrise. Surf shortboard. Cherche sessions matinales.',
          sex: Sex.FEMALE,
          emailNotif: true,
          maxDistanceKm: 30,
          wantsLesson: true,
          lessonSport: 'surf',
          lat: 48.8566,
          lng: 2.3522,
        },
      },
    },
    include: { riderProfile: true },
  });

  if (rider.riderProfile) {
    await prisma.riderDiscipline.createMany({
      data: [
        { profileId: rider.riderProfile.id, sport: 'surf', level: 'intermediate' },
        { profileId: rider.riderProfile.id, sport: 'kitesurf', level: 'beginner' },
      ],
      skipDuplicates: true,
    });
  }

  // Second rider for kitesurf lesson demo
  const riderKite = await prisma.user.create({
    data: {
      email: 'dev+kite@test.com',
      password: hashed,
      role: Role.RIDER,
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
      consentIp: '127.0.0.1',
      riderProfile: {
        create: {
          displayName: 'Blobkite',
          bio: 'Kite débutant, cherche cours découverte.',
          sex: Sex.FEMALE,
          emailNotif: true,
          wantsLesson: true,
          lessonSport: 'kitesurf',
          lat: 48.8466,
          lng: 2.3622,
        },
      },
    },
    include: { riderProfile: true },
  });
  if (riderKite.riderProfile) {
    await prisma.riderDiscipline.createMany({
      data: [
        { profileId: riderKite.riderProfile.id, sport: 'kitesurf', level: 'beginner' },
      ],
      skipDuplicates: true,
    });
  }

  // Pro user (email verified)
  const pro = await prisma.user.create({
    data: {
      email: 'dev+pro@test.com',
      password: hashed,
      role: Role.PRO,
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
      consentIp: '127.0.0.1',
    },
  });

  // Create pro profile
  await prisma.proProfile.create({
    data: {
      userId: pro.id,
      businessName: 'BlobPro School',
      bio: 'Monitrice indépendante, 8 ans d\'expérience. Cours particuliers et packs découverte.',
      pricePerHour: 60,
      emailNotif: true,
      lat: 48.8666,
      lng: 2.3122,
    },
  });

  // Demo match + conversation + a few messages
  const match = await prisma.match.create({
    data: { userOneId: rider.id, userTwoId: pro.id },
  });
  const conv = await prisma.conversation.create({ data: { matchId: match.id } });
  await prisma.conversationMember.createMany({
    data: [
      { conversationId: conv.id, userId: rider.id },
      { conversationId: conv.id, userId: pro.id },
    ],
    skipDuplicates: true,
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: conv.id,
        senderId: rider.id,
        type: 'TEXT',
        content: 'Salut ! Partant·e pour une session demain matin ? 🌊',
      },
      {
        conversationId: conv.id,
        senderId: pro.id,
        type: 'TEXT',
        content: 'Oui ! 8h à la plage centrale, houle bien orientée 👍',
      },
    ],
    skipDuplicates: true,
  });

  // Optional: a conversation sample could be added later
  // Keep seed minimal and fast for CI/dev

  // eslint-disable-next-line no-console
  console.log('Seed completed: users dev+rider@test.com / dev+pro@test.com (password: Passw0rd!)');
  if (!client) await prisma.$disconnect();
}

// If executed via `prisma db seed`, run standalone
if (require.main === module) {
  runSeed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
