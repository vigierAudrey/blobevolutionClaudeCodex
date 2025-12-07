import 'dotenv/config';
import { resolve } from 'path';
import { PrismaClient, Role, Sex, Level, Sport, DecisionKind, MatchStatus, BookingRequestStatus } from '@prisma/client';
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
  const devEmails = Array.from({length: 32}, (_, i) => `dev+rider${i+1}@test.com`)
    .concat(Array.from({length: 9}, (_, i) => `dev+pro${i+1}@test.com`))
    .concat(['dev+admin@test.com']);

  const SUPER_ADMIN_PERMISSIONS = [
    'users.view',
    'users.suspend',
    'users.delete',
    'pros.verify',
    'pros.manage',
    'reports.view',
    'reports.moderate',
    'analytics.view',
    'permissions.manage',
    'system.configure'
  ];

  await prisma.message.deleteMany({
    where: {
      conversation: {
        members: {
          some: {
            user: { email: { in: devEmails } }
          }
        }
      }
    }
  });
  await prisma.conversationMember.deleteMany({ where: { user: { email: { in: devEmails } } } });
  await prisma.conversation.deleteMany({
    where: {
      OR: [
        { members: { some: { user: { email: { in: devEmails } } } } },
        {
          match: {
            OR: [
              { userOne: { email: { in: devEmails } } },
              { userTwo: { email: { in: devEmails } } }
            ]
          }
        }
      ]
    }
  });
  await prisma.matchDecision.deleteMany({ where: { actor: { email: { in: devEmails } } } });
  await prisma.match.deleteMany({
    where: {
      OR: [
        { userOne: { email: { in: devEmails } } },
        { userTwo: { email: { in: devEmails } } }
      ]
    }
  });
  await prisma.lastSearch.deleteMany({ where: { user: { email: { in: devEmails } } } });
  await prisma.profileReport.deleteMany({
    where: {
      OR: [
        { reporter: { email: { in: devEmails } } },
        { reportedProfile: { user: { email: { in: devEmails } } } }
      ]
    }
  });
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
    { name: 'Hourtin', lat: 45.2041, lng: -1.1476 },
    { name: 'Montalivet', lat: 45.4385, lng: -1.1393 },
    { name: 'Biscarrosse', lat: 44.4214, lng: -1.2648 },
    { name: 'Capbreton', lat: 43.642, lng: -1.427 },
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

  const randomDateWithin = (days: number) => {
    const now = new Date();
    const past = new Date(now);
    past.setDate(now.getDate() - days);
    const timestamp = past.getTime() + Math.random() * (now.getTime() - past.getTime());
    return new Date(timestamp);
  };

  const addHours = (date: Date, hours: number) => {
    const copy = new Date(date);
    copy.setHours(copy.getHours() + hours);
    return copy;
  };

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

  const levels = [Level.beginner, Level.intermediate, Level.advanced];
  const sports = [Sport.surf, Sport.kitesurf];
  const sexes = [Sex.FEMALE, Sex.MALE, Sex.OTHER, Sex.UNSPECIFIED];

  // Create 20 riders with varied profiles
  const riders = [];
  for (let i = 0; i < 20; i++) {
    const location = locations[i % locations.length];
    const wantsLessonFlag = Math.random() > 0.6;
    const preferredLessonSport = Math.random() > 0.5 ? Sport.surf : Sport.kitesurf;
    const lessonStudents = wantsLessonFlag ? (Math.random() > 0.6 ? 2 : 1) : null;
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
            emailNotif: Math.random() > 0.3,
            maxDistanceKm: [15, 25, 30, 50, 75][i % 5],
            wantsLesson: wantsLessonFlag,
            lessonSport: preferredLessonSport,
            lessonStudentCount: lessonStudents,
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
    const chosenSports = numSports === 2 ? [Sport.surf, Sport.kitesurf] : [sports[Math.floor(Math.random() * sports.length)]];

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

    const searchSport = chosenSports[0];
    const searchLevel = levels[Math.floor(Math.random() * levels.length)];

    await prisma.lastSearch.upsert({
      where: { userId: rider.id },
      update: {
        sport: searchSport,
        level: searchLevel,
        distanceKm: [10, 25, 50, 75][i % 4],
        lat: rider.riderProfile?.lat ?? location.lat,
        lng: rider.riderProfile?.lng ?? location.lng,
        updatedAt: randomDateWithin(30)
      },
      create: {
        userId: rider.id,
        sport: searchSport,
        level: searchLevel,
        distanceKm: [10, 25, 50, 75][i % 4],
        lat: rider.riderProfile?.lat ?? location.lat,
        lng: rider.riderProfile?.lng ?? location.lng,
        date: randomDateWithin(15),
        createdAt: randomDateWithin(60)
      }
    });

    const sessionEntries = Array.from({ length: 3 }).map(() => {
      const createdAt = randomDateWithin(60);
      return {
        userId: rider.id,
        createdAt,
        expiresAt: addHours(createdAt, 6)
      };
    });
    await prisma.session.createMany({ data: sessionEntries });

    riders.push(rider);
  }

  type SouthWestRiderSeed = {
    emailSuffix: number;
    displayName: string;
    bio: string;
    sex: Sex;
    emailNotif: boolean;
    maxDistanceKm: number;
    wantsLesson: boolean;
    lessonSport?: Sport;
    location: { lat: number; lng: number };
    disciplines: Array<{ sport: Sport; level: Level }>;
    preferredSearch: { sport: Sport; level: Level; distanceKm: number };
    lessonStudentCount?: number;
  };

  const southWestRiderSeeds: SouthWestRiderSeed[] = [
    {
      emailSuffix: 21,
      displayName: 'Maelys Lacanau',
      bio: 'Rider locale de Lacanau, toujours au lever du soleil pour peaufiner les take-off.',
      sex: Sex.FEMALE,
      emailNotif: true,
      maxDistanceKm: 30,
      wantsLesson: false,
      lessonSport: Sport.surf,
      location: { lat: 44.981, lng: -1.207 },
      disciplines: [
        { sport: Sport.surf, level: Level.advanced },
        { sport: Sport.kitesurf, level: Level.intermediate }
      ],
      preferredSearch: { sport: Sport.surf, level: Level.advanced, distanceKm: 30 }
    },
    {
      emailSuffix: 22,
      displayName: 'Theo Côte dArgent',
      bio: 'Glisseur polyvalent, sessions kite en downwind entre Lacanau et Hourtin.',
      sex: Sex.MALE,
      emailNotif: true,
      maxDistanceKm: 40,
      wantsLesson: true,
      lessonSport: Sport.kitesurf,
      lessonStudentCount: 2,
      location: { lat: 45.209, lng: -1.132 },
      disciplines: [
        { sport: Sport.kitesurf, level: Level.advanced },
        { sport: Sport.surf, level: Level.intermediate }
      ],
      preferredSearch: { sport: Sport.kitesurf, level: Level.advanced, distanceKm: 35 }
    },
    {
      emailSuffix: 23,
      displayName: 'Lena Hourtin',
      bio: 'Toujours motivée pour initier les nouveaux riders sur le lac dHourtin.',
      sex: Sex.FEMALE,
      emailNotif: false,
      maxDistanceKm: 25,
      wantsLesson: true,
      lessonSport: Sport.surf,
      lessonStudentCount: 1,
      location: { lat: 45.1905, lng: -1.1483 },
      disciplines: [
        { sport: Sport.surf, level: Level.beginner },
        { sport: Sport.kitesurf, level: Level.beginner }
      ],
      preferredSearch: { sport: Sport.kitesurf, level: Level.beginner, distanceKm: 25 }
    },
    {
      emailSuffix: 24,
      displayName: 'Noah Hourtin',
      bio: 'Kiter freestyle, je cherche des partenaires pour progresser en handle pass.',
      sex: Sex.MALE,
      emailNotif: true,
      maxDistanceKm: 30,
      wantsLesson: false,
      lessonSport: Sport.kitesurf,
      location: { lat: 45.1957, lng: -1.1671 },
      disciplines: [
        { sport: Sport.kitesurf, level: Level.advanced }
      ],
      preferredSearch: { sport: Sport.kitesurf, level: Level.advanced, distanceKm: 30 }
    },
    {
      emailSuffix: 25,
      displayName: 'Iris Montalivet',
      bio: 'Waves lover, jorganise des sorties surf sunset sur Montalivet.',
      sex: Sex.FEMALE,
      emailNotif: true,
      maxDistanceKm: 20,
      wantsLesson: false,
      lessonSport: Sport.surf,
      location: { lat: 45.4423, lng: -1.1534 },
      disciplines: [
        { sport: Sport.surf, level: Level.intermediate }
      ],
      preferredSearch: { sport: Sport.surf, level: Level.intermediate, distanceKm: 20 }
    },
    {
      emailSuffix: 26,
      displayName: 'Yann Medoc',
      bio: 'Guide local, je partage les bancs de sable secrets de Montalivet.',
      sex: Sex.MALE,
      emailNotif: true,
      maxDistanceKm: 35,
      wantsLesson: false,
      lessonSport: Sport.surf,
      location: { lat: 45.4211, lng: -1.1431 },
      disciplines: [
        { sport: Sport.surf, level: Level.advanced }
      ],
      preferredSearch: { sport: Sport.surf, level: Level.advanced, distanceKm: 30 }
    },
    {
      emailSuffix: 27,
      displayName: 'Ariane Biscarrosse',
      bio: 'Rideuse multisport, toujours partante pour alterner surf et foil sur Biscarrosse.',
      sex: Sex.FEMALE,
      emailNotif: true,
      maxDistanceKm: 40,
      wantsLesson: true,
      lessonSport: Sport.kitesurf,
      lessonStudentCount: 3,
      location: { lat: 44.4203, lng: -1.2589 },
      disciplines: [
        { sport: Sport.surf, level: Level.advanced },
        { sport: Sport.kitesurf, level: Level.intermediate }
      ],
      preferredSearch: { sport: Sport.kitesurf, level: Level.intermediate, distanceKm: 40 }
    },
    {
      emailSuffix: 28,
      displayName: 'Mathis Bisca',
      bio: 'Debutant en surf, je cherche des binômes pour progresser en douceur.',
      sex: Sex.MALE,
      emailNotif: false,
      maxDistanceKm: 25,
      wantsLesson: true,
      lessonSport: Sport.surf,
      lessonStudentCount: 2,
      location: { lat: 44.4051, lng: -1.2825 },
      disciplines: [
        { sport: Sport.surf, level: Level.beginner }
      ],
      preferredSearch: { sport: Sport.surf, level: Level.beginner, distanceKm: 20 }
    },
    {
      emailSuffix: 29,
      displayName: 'Cleo Capbreton',
      bio: 'Mordu de barrels, je surveille la Graviere et Capbreton chaque swell.',
      sex: Sex.OTHER,
      emailNotif: true,
      maxDistanceKm: 20,
      wantsLesson: false,
      lessonSport: Sport.surf,
      location: { lat: 43.6428, lng: -1.4405 },
      disciplines: [
        { sport: Sport.surf, level: Level.advanced }
      ],
      preferredSearch: { sport: Sport.surf, level: Level.advanced, distanceKm: 20 }
    },
    {
      emailSuffix: 30,
      displayName: 'Loris Capbreton',
      bio: 'Kitesurfer strapless, toujours pret pour un roadtrip jusqua Hossegor.',
      sex: Sex.MALE,
      emailNotif: true,
      maxDistanceKm: 45,
      wantsLesson: false,
      lessonSport: Sport.kitesurf,
      location: { lat: 43.6381, lng: -1.4252 },
      disciplines: [
        { sport: Sport.kitesurf, level: Level.intermediate }
      ],
      preferredSearch: { sport: Sport.kitesurf, level: Level.intermediate, distanceKm: 35 }
    },
    {
      emailSuffix: 31,
      displayName: 'Soline Hossegor',
      bio: 'Coach benevole, jaide les rideuses a trouver confiance sur les beachbreaks.',
      sex: Sex.FEMALE,
      emailNotif: true,
      maxDistanceKm: 30,
      wantsLesson: true,
      lessonSport: Sport.surf,
      lessonStudentCount: 2,
      location: { lat: 43.6662, lng: -1.3921 },
      disciplines: [
        { sport: Sport.surf, level: Level.advanced },
        { sport: Sport.kitesurf, level: Level.beginner }
      ],
      preferredSearch: { sport: Sport.surf, level: Level.intermediate, distanceKm: 25 }
    },
    {
      emailSuffix: 32,
      displayName: 'Enzo Hossegor',
      bio: 'Competiteur junior en surf, je cherche des sparrings pour push mes airs.',
      sex: Sex.MALE,
      emailNotif: false,
      maxDistanceKm: 25,
      wantsLesson: false,
      lessonSport: Sport.surf,
      location: { lat: 43.6599, lng: -1.3967 },
      disciplines: [
        { sport: Sport.surf, level: Level.advanced }
      ],
      preferredSearch: { sport: Sport.surf, level: Level.advanced, distanceKm: 25 }
    }
  ];

  console.log('Adding dedicated south-west riders...');
  for (const seed of southWestRiderSeeds) {
    const rider = await prisma.user.create({
      data: {
        email: `dev+rider${seed.emailSuffix}@test.com`,
        password: hashed,
        role: Role.RIDER,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
        consentIp: '127.0.0.1',
        riderProfile: {
          create: {
            displayName: seed.displayName,
            bio: seed.bio,
            sex: seed.sex,
            emailNotif: seed.emailNotif,
            maxDistanceKm: seed.maxDistanceKm,
            wantsLesson: seed.wantsLesson,
            lessonSport: seed.lessonSport ?? seed.disciplines[0].sport,
            lessonStudentCount: seed.wantsLesson ? seed.lessonStudentCount ?? 2 : null,
            lat: seed.location.lat,
            lng: seed.location.lng,
          },
        },
      },
      include: { riderProfile: true },
    });

    await prisma.riderDiscipline.createMany({
      data: seed.disciplines.map((discipline) => ({
        profileId: rider.riderProfile!.id,
        sport: discipline.sport,
        level: discipline.level,
      })),
      skipDuplicates: true,
    });

    await prisma.lastSearch.upsert({
      where: { userId: rider.id },
      update: {
        sport: seed.preferredSearch.sport,
        level: seed.preferredSearch.level,
        distanceKm: seed.preferredSearch.distanceKm,
        lat: seed.location.lat,
        lng: seed.location.lng,
        updatedAt: randomDateWithin(20)
      },
      create: {
        userId: rider.id,
        sport: seed.preferredSearch.sport,
        level: seed.preferredSearch.level,
        distanceKm: seed.preferredSearch.distanceKm,
        lat: seed.location.lat,
        lng: seed.location.lng,
        date: randomDateWithin(10),
        createdAt: randomDateWithin(45)
      }
    });

    const sessionEntries = Array.from({ length: 2 }).map(() => {
      const createdAt = randomDateWithin(45);
      return {
        userId: rider.id,
        createdAt,
        expiresAt: addHours(createdAt, 6)
      };
    });
    await prisma.session.createMany({ data: sessionEntries });

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
      const sport = j === 0 ? Sport.surf : Sport.kitesurf;
      const level = levels[j]; // Varie le niveau selon l'offre

      await prisma.proOffer.create({
        data: {
          proProfileId: proProfile.id,
          sport,
          level,
          title: `Cours ${sport} niveau ${level === Level.beginner ? 'débutant' : level === Level.intermediate ? 'intermédiaire' : 'confirmé'}`,
          description: `Apprenez le ${sport} avec nos moniteurs expérimentés. Matériel fourni, sécurité garantie. ${level === Level.beginner ? 'Première fois ? Parfait pour découvrir!' : level === Level.intermediate ? 'Perfectionnez votre technique.' : 'Repoussez vos limites!'}`,
          hourlyRate: [45, 55, 60, 70, 80][i],
          isActive: true,
          lat: location.lat + (Math.random() - 0.5) * 0.02,
          lng: location.lng + (Math.random() - 0.5) * 0.02,
        },
      });
    }

    pros.push(pro);
  }

  const southWestProSeeds = [
    {
      emailSuffix: 6,
      businessName: 'Lacanau Surf Clinics',
      bio: 'Coaching intensif sur les beachbreaks de Lacanau. Feedback video systematique.',
      pricePerHour: 70,
      verified: true,
      location: { lat: 44.9805, lng: -1.2003 },
      offers: [
        {
          sport: Sport.surf,
          level: Level.beginner,
          title: 'Surf debutant Lacanau',
          description: 'Découverte encadrée sur les bancs les plus doux, materiel et video inclus.',
          hourlyRate: 70
        },
        {
          sport: Sport.surf,
          level: Level.advanced,
          title: 'Surf coaching performance',
          description: 'Analyse video et travail sur manoeuvres critiques pour riders confirms.',
          hourlyRate: 85
        }
      ]
    },
    {
      emailSuffix: 7,
      businessName: 'Hourtin Kite Progress',
      bio: 'Structure specialisee foil et freeride sur lac dHourtin, moniteurs IKO.',
      pricePerHour: 65,
      verified: true,
      location: { lat: 45.1892, lng: -1.1471 },
      offers: [
        {
          sport: Sport.kitesurf,
          level: Level.beginner,
          title: 'Init kite lac Hourtin',
          description: 'Maitre nageur secouriste a bord, radio coaching et bateau securite.',
          hourlyRate: 65
        },
        {
          sport: Sport.kitesurf,
          level: Level.intermediate,
          title: 'Kite foil progression',
          description: 'Sessions bateau pour travailler waterstart et transitions strapless.',
          hourlyRate: 80
        }
      ]
    },
    {
      emailSuffix: 8,
      businessName: 'Bisca Surf & Ride',
      bio: 'Equipe locale, surf & kite pour tous niveaux avec sensibilisation a locéan.',
      pricePerHour: 60,
      verified: false,
      location: { lat: 44.4209, lng: -1.2599 },
      offers: [
        {
          sport: Sport.surf,
          level: Level.intermediate,
          title: 'Surf progression Bisca',
          description: 'Travail sur lecture de vague et gestion du lineup, petit groupe de 4 max.',
          hourlyRate: 60
        },
        {
          sport: Sport.kitesurf,
          level: Level.beginner,
          title: 'Discover kite plage Nord',
          description: 'Atelier securite, fenetre de vol puis mise a leau progressive.',
          hourlyRate: 65
        }
      ]
    },
    {
      emailSuffix: 9,
      businessName: 'Hossegor Peak Coaching',
      bio: 'Collectif de coachs FFS, specialistes haut niveau surf & strapless.',
      pricePerHour: 85,
      verified: true,
      location: { lat: 43.6645, lng: -1.3908 },
      offers: [
        {
          sport: Sport.surf,
          level: Level.advanced,
          title: 'Surf high performance Hossegor',
          description: 'Video analyse, entrainement specifique air et tubes, spots Hossegor/Capbreton.',
          hourlyRate: 95
        },
        {
          sport: Sport.kitesurf,
          level: Level.intermediate,
          title: 'Strapless wave coaching',
          description: 'Session mobile selon conditions, travail carving et re-entry strapless.',
          hourlyRate: 90
        }
      ]
    }
  ];

  console.log('Adding dedicated south-west pros...');
  for (const seed of southWestProSeeds) {
    const pro = await prisma.user.create({
      data: {
        email: `dev+pro${seed.emailSuffix}@test.com`,
        password: hashed,
        role: Role.PRO,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
        consentIp: '127.0.0.1',
      },
    });

    const proProfile = await prisma.proProfile.create({
      data: {
        userId: pro.id,
        businessName: seed.businessName,
        bio: seed.bio,
        pricePerHour: seed.pricePerHour,
        emailNotif: true,
        verified: seed.verified,
        lat: seed.location.lat,
        lng: seed.location.lng,
      },
    });

    for (const offer of seed.offers) {
      await prisma.proOffer.create({
        data: {
          proProfileId: proProfile.id,
          sport: offer.sport,
          level: offer.level,
          title: offer.title,
          description: offer.description,
          hourlyRate: offer.hourlyRate,
          isActive: true,
          lat: seed.location.lat,
          lng: seed.location.lng,
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
          permissions: SUPER_ADMIN_PERMISSIONS,
        },
      },
    },
  });

  // Create some demo conversations
  console.log('Creating demo conversations...');

  const acceptedDecisions: Array<{ matchId: string; conversationId: string; createdAt: Date }> = [];

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

  await prisma.conversationMember.update({
    where: {
      conversationId_userId: {
        conversationId: conv1.id,
        userId: pros[0].id,
      },
    },
    data: {
      blockedAt: new Date(),
    },
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
      { conversationId: conv3.id, userId: pros[1].id }
    ],
    skipDuplicates: true
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: conv3.id,
        senderId: pros[0].id,
        type: 'TEXT',
        content: 'Salut collègue ! Comment ça se passe la saison chez vous ?'
      },
      {
        conversationId: conv3.id,
        senderId: pros[1].id,
        type: 'TEXT',
        content: 'Hey ! Très bien merci, beaucoup de demandes cette année. Et toi ?'
      }
    ],
    skipDuplicates: true
  });

  console.log('Simulating rider matching decisions...');

  const riderCount = riders.length;
  for (let i = 0; i < riderCount; i++) {
    const actor = riders[i];
    const targets = [riders[(i + 1) % riderCount], riders[(i + 5) % riderCount]];

    for (const target of targets) {
      if (!target?.riderProfile) continue;

      const decisionType: DecisionKind = (i + targets.indexOf(target)) % 3 === 0 ? 'REFUSE' : 'ACCEPT';
      const createdAt = randomDateWithin(90);

      await prisma.matchDecision.upsert({
        where: {
          actorUserId_targetProfileId: {
            actorUserId: actor.id,
            targetProfileId: target.riderProfile.id
          }
        },
        update: {
          decision: decisionType,
          updatedAt: createdAt
        },
        create: {
          actorUserId: actor.id,
          targetProfileId: target.riderProfile.id,
          decision: decisionType,
          createdAt,
          updatedAt: createdAt
        }
      });

      if (decisionType === 'ACCEPT') {
        const existingMatch = await prisma.match.findFirst({
          where: {
            OR: [
              { userOneId: actor.id, userTwoId: target.id },
              { userOneId: target.id, userTwoId: actor.id }
            ]
          }
        });

        const match = existingMatch
          ? existingMatch
          : await prisma.match.create({
              data: {
                userOneId: actor.id,
                userTwoId: target.id,
                status: MatchStatus.ACTIVE,
                createdAt,
                lastActivityAt: addHours(createdAt, 2)
              }
            });

        const existingConversation = await prisma.conversation.findFirst({
          where: {
            OR: [
              { matchId: match.id },
              {
                members: {
                  some: { userId: actor.id }
                },
                AND: {
                  members: {
                    some: { userId: target.id }
                  }
                }
              }
            ]
          }
        });

        if (!existingConversation) {
          const conversation = await prisma.conversation.create({
            data: {
              matchId: match.id,
              type: 'RIDER_TO_RIDER',
              createdAt,
              updatedAt: addHours(createdAt, 3)
            }
          });

          await prisma.conversationMember.createMany({
            data: [
              { conversationId: conversation.id, userId: actor.id },
              { conversationId: conversation.id, userId: target.id }
            ]
          });

          await prisma.message.createMany({
            data: [
              {
                conversationId: conversation.id,
                senderId: actor.id,
                type: 'TEXT',
                content: `Hey ${target.riderProfile.displayName?.split(' ')[0] ?? 'rider'} ! Session prévue ${createdAt.toLocaleDateString('fr-FR')} ?`,
                createdAt
              },
              {
                conversationId: conversation.id,
                senderId: target.id,
                type: 'TEXT',
                content: 'Yes, je ramène la wax et on se retrouve sur place.',
                createdAt: addHours(createdAt, 1)
              }
            ]
          });
        }
      }
    }
  }

  console.log('Creating extra refuse decisions for analytics balance...');

  for (let i = 0; i < 12; i++) {
    const actor = riders[(i * 2) % riderCount];
    const target = riders[(i * 3 + 4) % riderCount];
    if (!target.riderProfile) continue;
    const createdAt = randomDateWithin(120);
    await prisma.matchDecision.upsert({
      where: {
        actorUserId_targetProfileId: {
          actorUserId: actor.id,
          targetProfileId: target.riderProfile.id
        }
      },
      update: {
        decision: 'REFUSE',
        updatedAt: createdAt
      },
      create: {
        actorUserId: actor.id,
        targetProfileId: target.riderProfile.id,
        decision: 'REFUSE',
        createdAt,
        updatedAt: createdAt
      }
    });
  }

  console.log('Creating support reports...');
  for (let i = 0; i < 6; i++) {
    const reporter = riders[i];
    const reported = riders[(i + 6) % riderCount];
    if (!reported.riderProfile) continue;
    await prisma.profileReport.create({
      data: {
        reporterUserId: reporter.id,
        reportedProfileId: reported.riderProfile.id,
        reason: i % 2 === 0 ? 'Problème comportement' : 'Profil suspect',
        createdAt: randomDateWithin(40)
      }
    });
  }

  console.log('Creating availability samples...');

  const availabilityBaseStart = addHours(new Date(), 4);
  const availabilityDefinitions = [
    {
      proUserId: pros[0].id,
      sport: Sport.surf,
      levels: ['beginner', 'intermediate'],
      startAt: availabilityBaseStart,
      endAt: addHours(availabilityBaseStart, 2),
      capacity: 4,
      bookedCount: 1,
      status: 'OPEN' as const,
      spotName: 'Plage Centrale',
      spotLat: 43.493,
      spotLng: -1.558,
      price: '60.00'
    },
    {
      proUserId: pros[1].id,
      sport: Sport.kitesurf,
      levels: ['intermediate', 'advanced'],
      startAt: addHours(availabilityBaseStart, 8),
      endAt: addHours(availabilityBaseStart, 10),
      capacity: 3,
      bookedCount: 0,
      status: 'OPEN' as const,
      spotName: 'Lagune Nord',
      spotLat: 43.210,
      spotLng: -1.456,
      price: '85.00'
    },
    {
      proUserId: pros[2].id,
      sport: Sport.surf,
      levels: ['beginner'],
      startAt: addHours(availabilityBaseStart, 20),
      endAt: addHours(availabilityBaseStart, 22),
      capacity: 2,
      bookedCount: 0,
      status: 'OPEN' as const,
      spotName: 'Spot Secret',
      spotLat: 43.320,
      spotLng: -1.60,
      price: '55.00'
    }
  ];

  const availabilityRecords = await Promise.all(
    availabilityDefinitions.map((slot) =>
      prisma.proAvailability.create({
        data: {
          proUserId: slot.proUserId,
          sport: slot.sport,
          levels: slot.levels,
          startAt: slot.startAt,
          endAt: slot.endAt,
          capacity: slot.capacity,
          bookedCount: slot.bookedCount,
          status: slot.status,
          spotName: slot.spotName,
          spotLat: slot.spotLat,
          spotLng: slot.spotLng,
          price: slot.price
        }
      })
    )
  );

  await prisma.bookingRequest.create({
    data: {
      riderUserId: riders[0].id,
      availabilityId: availabilityRecords[0].id,
      status: BookingRequestStatus.ACCEPTED,
      respondedAt: new Date(),
      message: 'Départ depuis Biarritz, ok pour co-voiturage ?'
    }
  });

  await prisma.booking.create({
    data: {
      availabilityId: availabilityRecords[0].id,
      riderUserId: riders[0].id,
      status: 'CONFIRMED'
    }
  });

  await prisma.bookingRequest.create({
    data: {
      riderUserId: riders[3].id,
      availabilityId: availabilityRecords[1].id,
      status: BookingRequestStatus.PENDING,
      message: 'Intéressé pour progresser en kite !'
    }
  });
  console.log('✅ Seed completed successfully!');
  console.log('📧 20 riders: dev+rider1@test.com to dev+rider20@test.com');
  console.log('🏄 5 pros: dev+pro1@test.com to dev+pro5@test.com');
  console.log('👨‍💼 1 admin: dev+admin@test.com');
  console.log('🔑 Password for all accounts: Passw0rd!');
  console.log('📍 Users spread across 15 French locations');
  console.log('🎯 Varied levels, sports, and preferences + recherches récentes');
  console.log('🕒 Sessions générées pour refléter l’activité des riders');
  console.log('🤝 Décisions de matching acceptées/refusées avec conversations simulées');
  console.log('📅 Créneaux pros disponibles + exemples de demandes');
  console.log('🚨 Signalements de support pour alimenter les analytics');

  if (!client) await prisma.$disconnect();
}

// If executed via `prisma db seed`, run standalone
if (require.main === module) {
  runSeed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
