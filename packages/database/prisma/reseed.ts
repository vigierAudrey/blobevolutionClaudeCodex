import 'dotenv/config';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { runSeed } from './seed';

try {
  // Load env from repo root if available
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  const ok = dotenv.config({ path: resolve(__dirname, '../../../.env') });
  if (!ok?.parsed) dotenv.config({ path: resolve(__dirname, './.env') });
} catch {}

const prisma = new PrismaClient();

async function clearAll() {
  // Delete in dependency order (children first)
  await prisma.message.deleteMany();
  await prisma.conversationMember.deleteMany();
  await prisma.contactRequestResponse.deleteMany();
  await prisma.contactRequest.deleteMany();
  await prisma.conversationBlockEvent.deleteMany();
  await prisma.conversationInvitation.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.matchDecision.deleteMany();
  await prisma.profileReport.deleteMany();
  await prisma.match.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.bookingRequest.deleteMany();
  await prisma.proAvailabilityInteraction.deleteMany();
  await prisma.proAvailability.deleteMany();
  await prisma.riderDiscipline.deleteMany();
  await prisma.proOffer.deleteMany();
  await prisma.riderProfile.deleteMany();
  await prisma.proProfile.deleteMany();
  await prisma.adminProfile.deleteMany();
  await prisma.lastSearch.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.analyticsEvent.deleteMany();
  await prisma.analyticsDailyAgg.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await clearAll();
  await runSeed(prisma);
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

