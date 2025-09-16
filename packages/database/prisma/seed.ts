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

  // Cleanup all existing dev data
  const devEmails = Array.from({length: 20}, (_, i) => `dev+rider${i+1}@test.com`)
    .concat(Array.from({length: 5}, (_, i) => `dev+pro${i+1}@test.com`))
    .concat(['dev+admin@test.com']);

  await prisma.refreshToken.deleteMany({ where: { user: { email: { in: devEmails } } } });
  await prisma.session.deleteMany({ where: { user: { email: { in: devEmails } } } });
  await prisma.passwordResetToken.deleteMany({ where: { user: { email: { in: devEmails } } } });
  await prisma.emailVerificationToken.deleteMany({ where: { user: { email: { in: devEmails } } } });
  await prisma.riderDiscipline.deleteMany({ where: { profile: { user: { email: { in: devEmails } } } } });
  await prisma.proOffer.deleteMany({ where: { proProfile: { user: { email: { in: devEmails } } } } });
  await prisma.riderProfile.deleteMany({ where: { user: { email: { in: devEmails } } } });
  await prisma.proProfile.deleteMany({ where: { user: { email: { in: devEmails } } } });
  await prisma.adminProfile.deleteMany({ where: { user: { email: { in: devEmails } } } });
  await prisma.user.deleteMany({ where: { email: { in: devEmails } } });

  const hashed = await bcrypt.hash('Passw0rd!', 12);

  // Localités françaises pour varier les géolocalisations
  const locations = [
    { name: 'Paris', lat: 48.8566, lng: 2.3522 },
    { name: 'Biarritz', lat: 43.4832, lng: -1.5586 },
    { name: 'Hossegor', lat: 43.6613, lng: -1.3976 },
    { name: 'Lacanau', lat: 44.9771, lng: -1.1942 },
    { name: 'La Rochelle', lat: 46.1603, lng: -1.1511 },
    { name: 'Marseille', lat: 43.2965, lng: 5.3698 },
    { name: 'Nice', lat: 43.7102, lng: 7.2620 },
    { name: 'Montpellier', lat: 43.6109, lng: 3.8763 },
    { name: 'Nantes', lat: 47.2184, lng: -1.5536 },
    { name: 'Bordeaux', lat: 44.8378, lng: -0.5792 },
    { name: 'Anglet', lat: 43.4924, lng: -1.5127 },
    { name: 'Leucate', lat: 42.9086, lng: 3.0314 },
    { name: 'Carnac', lat: 47.5827, lng: -3.0783 },
    { name: 'Quiberon', lat: 47.4847, lng: -3.1197 },
    { name: 'Saint-Malo', lat: 48.6496, lng: -2.0259 }
  ];

  const riderNames = [
    'Alex Surf', 'Sam Rider', 'Jordan Wave', 'Casey Ocean', 'Taylor Beach',
    'Morgan Sea', 'Riley Tide', 'Sage Storm', 'Quinn Current', 'Blake Shore',
    'Avery Salt', 'River Blue', 'Sky Marine', 'Luna Wave', 'Nova Ocean',
    'Kai Surf', 'Zara Beach', 'Leo Tide', 'Mia Storm', 'Finn Current'
  ];

  const riderBios = [
    'Passionné·e de surf depuis 10 ans, toujours partant·e pour de nouvelles sessions!',
    'Kite addict, j\'adore les sessions entre potes et découvrir de nouveaux spots.',
    'Surf & kite, team sunrise! Toujours motivé·e pour partager ma passion.',
    'Rider expérimenté·e, j\'aime transmettre mes techniques aux débutants.',
    'Sessions détente ou intense, peu importe tant qu\'on s\'amuse sur l\'eau!',
    'Nouvelle dans la région, cherche la communauté locale pour rider ensemble.',
    'Compétiteur·trice amateur, j\'aime progresser et repousser mes limites.',
    'Photographe aquatique à mes heures perdues, j\'immortalise nos sessions.',
    'Éco-rider, je milite pour des océans propres et des sessions responsables.',
    'Ancien·ne pro reconvertie, je partage maintenant ma passion en amateur.',
    'Week-end warrior, je profite de chaque moment libre pour aller à l\'eau.',
    'Voyageur·se des spots, toujours en quête de la vague parfaite.',
    'Rider nocturne, j\'adore les sessions sous les étoiles quand c\'est possible.',
    'Minimaliste du surf, une planche, une combi, et c\'est parti!',
    'Collectionneur·se de sensations, du surf au kite en passant par le windsurf.',
    'Local de longue date, je connais tous les secrets du coin.',
    'Débutant·e motivé·e, en quête de progression et de bons conseils.',
    'Rider famille, j\'initie mes enfants à la glisse avec patience.',
    'Philosophe de l\'océan, je médite autant que je ride.',
    'Technicien·ne de la glisse, j\'analyse chaque mouvement pour m\'améliorer.'
  ];

  console.log('Creating 20 rider users...');

  const levels = ['beginner', 'intermediate', 'advanced'];
  const sports = ['surf', 'kitesurf'];
  const sexes = [Sex.FEMALE, Sex.MALE, Sex.OTHER, Sex.UNSPECIFIED];
  const partnerPrefs = ['ALL', 'WOMEN', 'MEN'];

  // Create 20 riders with varied profiles
  const riders = [];
  for (let i = 0; i < 20; i++) {
    const location = locations[i % locations.length];
    const rider = await prisma.user.create({
      data: {
        email: `dev+rider${i+1}@test.com`,
        password: hashed,
        role: Role.RIDER,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
        consentIp: '127.0.0.1',
        riderProfile: {
          create: {
            displayName: riderNames[i],
            bio: riderBios[i],
            sex: sexes[i % sexes.length],
            partnerPref: partnerPrefs[i % partnerPrefs.length],
            emailNotif: Math.random() > 0.3,
            maxDistanceKm: [15, 25, 30, 50, 75][i % 5],
            wantsLesson: Math.random() > 0.6,
            lessonSport: Math.random() > 0.5 ? 'surf' : 'kitesurf',
            lat: location.lat + (Math.random() - 0.5) * 0.1, // Petit décalage aléatoire
            lng: location.lng + (Math.random() - 0.5) * 0.1,
          },
        },
      },
      include: { riderProfile: true },
    });

    // Add varied disciplines
    const riderDisciplines = [];
    const numSports = Math.random() > 0.6 ? 2 : 1; // 40% ont les deux sports
    const chosenSports = numSports === 2 ? ['surf', 'kitesurf'] : [sports[Math.floor(Math.random() * sports.length)]];

    for (const sport of chosenSports) {
      riderDisciplines.push({
        profileId: rider.riderProfile!.id,
        sport,
        level: levels[Math.floor(Math.random() * levels.length)]
      });
    }

    await prisma.riderDiscipline.createMany({
      data: riderDisciplines,
      skipDuplicates: true,
    });

    riders.push(rider);
  }

  console.log('Creating 5 pro users with offers...');

  const proNames = [
    'Ocean Academy',
    'Surf Evolution',
    'Kite Masters',
    'Wave Riders School',
    'Atlantic Surf Club'
  ];

  const proBios = [
    'École de surf reconnue, 15 ans d\'expérience. Cours collectifs et particuliers. Matériel fourni.',
    'Moniteurs diplômés d\'état. Spécialistes progression rapide. Stages intensifs week-end.',
    'Centre de formation kitesurf. Du débutant au perfectionnement. Spots exceptionnels.',
    'École indépendante, ambiance familiale. Méthode pédagogique éprouvée depuis 2010.',
    'Club historique de la côte. Cours tous niveaux, location matériel, coaching compétition.'
  ];

  const pros = [];
  for (let i = 0; i < 5; i++) {
    const location = locations[i + 2]; // Décaler pour varier les emplacements
    const pro = await prisma.user.create({
      data: {
        email: `dev+pro${i+1}@test.com`,
        password: hashed,
        role: Role.PRO,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
        consentIp: '127.0.0.1',
      },
    });

    // Create pro profile
    const proProfile = await prisma.proProfile.create({
      data: {
        userId: pro.id,
        businessName: proNames[i],
        bio: proBios[i],
        pricePerHour: [45, 55, 60, 70, 80][i], // Tarifs variés
        emailNotif: true,
        verified: i < 3, // Les 3 premiers sont vérifiés
        lat: location.lat + (Math.random() - 0.5) * 0.05,
        lng: location.lng + (Math.random() - 0.5) * 0.05,
      },
    });

    // Create offers for each pro
    const numOffers = i === 4 ? 1 : 2; // Le dernier pro n'a qu'une offre
    for (let j = 0; j < numOffers; j++) {
      const sport = j === 0 ? 'surf' : 'kitesurf';
      const level = levels[j]; // Varie le niveau selon l'offre

      await prisma.proOffer.create({
        data: {
          proProfileId: proProfile.id,
          sport,
          level,
          title: `Cours ${sport} niveau ${level === 'beginner' ? 'débutant' : level === 'intermediate' ? 'intermédiaire' : 'confirmé'}`,
          description: `Apprenez le ${sport} avec nos moniteurs expérimentés. Matériel fourni, sécurité garantie. ${level === 'beginner' ? 'Première fois ? Parfait pour découvrir!' : level === 'intermediate' ? 'Perfectionnez votre technique.' : 'Repoussez vos limites!'}`,
          hourlyRate: [45, 55, 60, 70, 80][i],
          isActive: true,
          lat: location.lat + (Math.random() - 0.5) * 0.02,
          lng: location.lng + (Math.random() - 0.5) * 0.02,
        },
      });
    }

    pros.push(pro);
  }

  // Create admin user
  console.log('Creating admin user...');
  await prisma.user.create({
    data: {
      email: 'dev+admin@test.com',
      password: hashed,
      role: Role.ADMIN,
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
      consentIp: '127.0.0.1',
      adminProfile: {
        create: {
          displayName: 'Admin Dev',
        },
      },
    },
  });

  // Create some demo conversations
  console.log('Creating demo conversations...');

  // Conversation rider-pro
  const match1 = await prisma.match.create({
    data: { userOneId: riders[0].id, userTwoId: pros[0].id },
  });
  const conv1 = await prisma.conversation.create({
    data: {
      matchId: match1.id,
      type: 'RIDER_TO_PRO'
    }
  });
  await prisma.conversationMember.createMany({
    data: [
      { conversationId: conv1.id, userId: riders[0].id },
      { conversationId: conv1.id, userId: pros[0].id },
    ],
    skipDuplicates: true,
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: conv1.id,
        senderId: riders[0].id,
        type: 'TEXT',
        content: 'Salut ! Je suis intéressé par vos cours de surf débutant 🏄‍♂️',
      },
      {
        conversationId: conv1.id,
        senderId: pros[0].id,
        type: 'TEXT',
        content: 'Bonjour ! Parfait, nous avons des créneaux libres cette semaine. Vous préférez le matin ou l\'après-midi ?',
      },
      {
        conversationId: conv1.id,
        senderId: riders[0].id,
        type: 'PROPOSAL',
        content: 'Proposition de session Samedi 10h @ Plage centrale',
        meta: { date: '2025-09-20', place: 'Plage centrale', note: 'Première leçon' },
      },
    ],
    skipDuplicates: true,
  });

  // Conversation rider-rider
  const match2 = await prisma.match.create({
    data: { userOneId: riders[1].id, userTwoId: riders[2].id },
  });
  const conv2 = await prisma.conversation.create({
    data: {
      matchId: match2.id,
      type: 'RIDER_TO_RIDER'
    }
  });
  await prisma.conversationMember.createMany({
    data: [
      { conversationId: conv2.id, userId: riders[1].id },
      { conversationId: conv2.id, userId: riders[2].id },
    ],
    skipDuplicates: true,
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: conv2.id,
        senderId: riders[1].id,
        type: 'TEXT',
        content: 'Hey ! Tu es dispo pour une session kite demain ? 🪁',
      },
      {
        conversationId: conv2.id,
        senderId: riders[2].id,
        type: 'TEXT',
        content: 'Salut ! Oui carrément ! Les conditions ont l\'air top 🌊',
      },
    ],
    skipDuplicates: true,
  });

  // Conversation pro-pro
  const match3 = await prisma.match.create({
    data: { userOneId: pros[0].id, userTwoId: pros[1].id },
  });
  const conv3 = await prisma.conversation.create({
    data: {
      matchId: match3.id,
      type: 'PRO_TO_PRO'
    }
  });
  await prisma.conversationMember.createMany({
    data: [
      { conversationId: conv3.id, userId: pros[0].id },
      { conversationId: conv3.id, userId: pros[1].id },
    ],
    skipDuplicates: true,
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: conv3.id,
        senderId: pros[0].id,
        type: 'TEXT',
        content: 'Salut collègue ! Comment ça se passe la saison chez vous ?',
      },
      {
        conversationId: conv3.id,
        senderId: pros[1].id,
        type: 'TEXT',
        content: 'Hey ! Très bien merci, beaucoup de demandes cette année. Et toi ?',
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Seed completed successfully!');
  console.log('📧 20 riders: dev+rider1@test.com to dev+rider20@test.com');
  console.log('🏄 5 pros: dev+pro1@test.com to dev+pro5@test.com');
  console.log('👨‍💼 1 admin: dev+admin@test.com');
  console.log('🔑 Password for all accounts: Passw0rd!');
  console.log('📍 Users spread across 15 French locations');
  console.log('🎯 Varied levels, sports, and preferences');
  console.log('💬 3 demo conversations with messages');

  if (!client) await prisma.$disconnect();
}

// If executed via `prisma db seed`, run standalone
if (require.main === module) {
  runSeed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
