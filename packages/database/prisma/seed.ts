import 'dotenv/config';
import { resolve } from 'path';
import { PrismaClient, Role, Sex } from '@prisma/client';
import bcrypt from 'bcrypt';

// Ensure env is loaded from repo root .env (fallback prisma/.env)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  const ok = dotenv.config({ path: resolve(__dirname, '../../../.env') });
  if (ok?.parsed) {
    // loaded from root
  } else {
    dotenv.config({ path: resolve(__dirname, './.env') });
  }
} catch {}

const prisma = new PrismaClient();

async function main() {
  // Idempotent cleanup of dev users by tag email
  const emails = ['dev+rider@test.com', 'dev+pro@test.com'];
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

  // Pro user (email verified)
  await prisma.user.create({
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

  // Optional: a conversation sample could be added later
  // Keep seed minimal and fast for CI/dev

  // eslint-disable-next-line no-console
  console.log('Seed completed: users dev+rider@test.com / dev+pro@test.com (password: Passw0rd!)');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

