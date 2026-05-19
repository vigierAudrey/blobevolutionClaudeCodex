/**
 * seed.pre-vps.ts — Comptes de test stables pour l'environnement pré-VPS
 *
 * Crée exactement 3 comptes avec UUIDs FIXES et credentials documentés.
 * Ces UUIDs sont référencés par smoke-test.sh pour qualifier le matching,
 * la messagerie et le booking.
 *
 * IMPORTANT : Ne jamais utiliser ces comptes en production.
 * Les emails se terminent en @pre-vps.blobinfini.local (domaine fictif).
 *
 * Credentials stables (à stocker dans .pre-vps.credentials — jamais dans git) :
 *   rider.a : rider.a@pre-vps.blobinfini.local / RiderAlpha2026!PreVPS
 *   rider.b : rider.b@pre-vps.blobinfini.local / RiderBeta2026!PreVPS
 *   pro.a   : pro.a@pre-vps.blobinfini.local   / ProAlpha2026!PreVPS
 */

import 'dotenv/config';
import { resolve } from 'path';
import {
  PrismaClient,
  Role,
  Sex,
  Level,
  Sport,
  MatchStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

try {
  const dotenv = require('dotenv');
  const envFile = process.env.ENV_FILE ?? resolve(__dirname, '../../../.env.pre-vps');
  dotenv.config({ path: envFile });
} catch {}

// UUIDs fixes — ne jamais changer (référencés par les scripts de smoke test)
export const PRE_VPS_IDS = {
  riderA:        '11111111-1111-4111-a111-111111111111',
  riderAProfile: '11111111-2222-4111-a111-111111111111',
  riderB:        '22222222-2222-4222-b222-222222222222',
  riderBProfile: '22222222-3333-4222-b222-222222222222',
  proA:          '33333333-3333-4333-c333-333333333333',
  proAProfile:   '33333333-4444-4333-c333-333333333333',
  // Match ACTIVE entre rider A et rider B (requis par POST /conversations/open RIDER_TO_RIDER)
  matchAB:       'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
} as const;

export const PRE_VPS_EMAILS = [
  'rider.a@pre-vps.blobinfini.local',
  'rider.b@pre-vps.blobinfini.local',
  'pro.a@pre-vps.blobinfini.local',
] as const;

async function runPreVpsSeed(client?: PrismaClient) {
  const prisma = client ?? new PrismaClient();

  if (process.env.APP_ENV !== 'pre-vps') {
    console.error('ABORT: seed.pre-vps.ts ne doit tourner qu\'avec APP_ENV=pre-vps');
    process.exit(1);
  }

  console.log('[seed.pre-vps] Nettoyage des comptes pré-VPS existants...');

  // Nettoyage ciblé uniquement sur les emails pré-VPS
  const emails = [...PRE_VPS_EMAILS];

  await prisma.message.deleteMany({
    where: {
      conversation: {
        members: { some: { user: { email: { in: emails } } } },
      },
    },
  });
  await prisma.conversationMember.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.conversation.deleteMany({
    where: {
      OR: [
        { members: { some: { user: { email: { in: emails } } } } },
        { match: { OR: [{ userOne: { email: { in: emails } } }, { userTwo: { email: { in: emails } } }] } },
      ],
    },
  });
  await prisma.matchDecision.deleteMany({ where: { actor: { email: { in: emails } } } });
  await prisma.match.deleteMany({
    where: { OR: [{ userOne: { email: { in: emails } } }, { userTwo: { email: { in: emails } } }] },
  });
  await prisma.lastSearch.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.profileReport.deleteMany({
    where: {
      OR: [
        { reporter: { email: { in: emails } } },
        { reportedProfile: { user: { email: { in: emails } } } },
      ],
    },
  });
  await prisma.refreshToken.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.riderDiscipline.deleteMany({ where: { profile: { user: { email: { in: emails } } } } });
  await prisma.riderProfile.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.proProfile.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });

  const hash = (pass: string) => bcrypt.hash(pass, 12);

  // ─── Rider A ───────────────────────────────────────────────────────────────
  console.log('[seed.pre-vps] Création rider A...');
  await prisma.user.create({
    data: {
      id: PRE_VPS_IDS.riderA,
      email: 'rider.a@pre-vps.blobinfini.local',
      password: await hash('RiderAlpha2026!PreVPS'),
      role: Role.RIDER,
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
      consentIp: '127.0.0.1',
      riderProfile: {
        create: {
          id: PRE_VPS_IDS.riderAProfile,
          displayName: 'Rider Alpha (pré-VPS)',
          bio: 'Compte de test pré-VPS — rider A.',
          sex: Sex.UNSPECIFIED,
          emailNotif: false,
          maxDistanceKm: 50,
          wantsLesson: false,
          // Biarritz
          lat: 43.4832,
          lng: -1.5586,
        },
      },
    },
  });
  await prisma.riderDiscipline.create({
    data: {
      profile: { connect: { id: PRE_VPS_IDS.riderAProfile } },
      sport: Sport.surf,
      level: Level.intermediate,
    },
  });
  await prisma.lastSearch.create({
    data: {
      userId: PRE_VPS_IDS.riderA,
      sport: Sport.surf,
      level: Level.intermediate,
      distanceKm: 50,
      lat: 43.4832,
      lng: -1.5586,
    },
  });

  // ─── Rider B ───────────────────────────────────────────────────────────────
  console.log('[seed.pre-vps] Création rider B...');
  await prisma.user.create({
    data: {
      id: PRE_VPS_IDS.riderB,
      email: 'rider.b@pre-vps.blobinfini.local',
      password: await hash('RiderBeta2026!PreVPS'),
      role: Role.RIDER,
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
      consentIp: '127.0.0.1',
      riderProfile: {
        create: {
          id: PRE_VPS_IDS.riderBProfile,
          displayName: 'Rider Beta (pré-VPS)',
          bio: 'Compte de test pré-VPS — rider B.',
          sex: Sex.UNSPECIFIED,
          emailNotif: false,
          maxDistanceKm: 50,
          wantsLesson: false,
          // Hossegor (15km de Biarritz → dans le rayon)
          lat: 43.6613,
          lng: -1.3976,
        },
      },
    },
  });
  await prisma.riderDiscipline.create({
    data: {
      profile: { connect: { id: PRE_VPS_IDS.riderBProfile } },
      sport: Sport.surf,
      level: Level.intermediate,
    },
  });
  await prisma.lastSearch.create({
    data: {
      userId: PRE_VPS_IDS.riderB,
      sport: Sport.surf,
      level: Level.intermediate,
      distanceKm: 50,
      lat: 43.6613,
      lng: -1.3976,
    },
  });

  // ─── Match ACTIVE rider A ↔ rider B ────────────────────────────────────────
  // Requis pour que POST /conversations/open RIDER_TO_RIDER fonctionne.
  // userOneId < userTwoId (contrainte unique @@unique([userOneId, userTwoId])).
  console.log('[seed.pre-vps] Création match ACTIVE rider A ↔ rider B...');
  await prisma.match.create({
    data: {
      id: PRE_VPS_IDS.matchAB,
      userOneId: PRE_VPS_IDS.riderA,
      userTwoId: PRE_VPS_IDS.riderB,
      status: MatchStatus.ACTIVE,
    },
  });

  // ─── Pro A ─────────────────────────────────────────────────────────────────
  console.log('[seed.pre-vps] Création pro A...');
  await prisma.user.create({
    data: {
      id: PRE_VPS_IDS.proA,
      email: 'pro.a@pre-vps.blobinfini.local',
      password: await hash('ProAlpha2026!PreVPS'),
      role: Role.PRO,
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
      consentIp: '127.0.0.1',
      proProfile: {
        create: {
          id: PRE_VPS_IDS.proAProfile,
          businessName: 'Pro Alpha (pré-VPS)',
          bio: 'Moniteur de test pré-VPS.',
          verified: true,
          // Capbreton
          lat: 43.642,
          lng: -1.427,
        },
      },
    },
  });

  console.log('[seed.pre-vps] OK');
  console.log('');
  console.log('  Comptes créés :');
  console.log('  rider.a@pre-vps.blobinfini.local  / RiderAlpha2026!PreVPS');
  console.log(`  → userId  : ${PRE_VPS_IDS.riderA}`);
  console.log(`  → profile : ${PRE_VPS_IDS.riderAProfile}`);
  console.log('');
  console.log('  rider.b@pre-vps.blobinfini.local  / RiderBeta2026!PreVPS');
  console.log(`  → userId  : ${PRE_VPS_IDS.riderB}`);
  console.log(`  → profile : ${PRE_VPS_IDS.riderBProfile}`);
  console.log('');
  console.log('  pro.a@pre-vps.blobinfini.local    / ProAlpha2026!PreVPS');
  console.log(`  → userId  : ${PRE_VPS_IDS.proA}`);
  console.log(`  → profile : ${PRE_VPS_IDS.proAProfile}`);

  await prisma.$disconnect();
}

runPreVpsSeed().catch((e) => {
  console.error(e);
  process.exit(1);
});
