#!/usr/bin/env node

/**
 * Script pour générer des données de test géolocalisées
 * Permet de tester les performances PostGIS avec plus de données
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Coordonnées des principales villes côtières françaises
const FRENCH_COASTAL_CITIES = [
  { name: 'Nice', lat: 43.7102, lng: 7.2620 },
  { name: 'Cannes', lat: 43.5528, lng: 7.0174 },
  { name: 'Marseille', lat: 43.2965, lng: 5.3698 },
  { name: 'Montpellier', lat: 43.6108, lng: 3.8767 },
  { name: 'Biarritz', lat: 43.4832, lng: -1.5586 },
  { name: 'La Rochelle', lat: 46.1603, lng: -1.1511 },
  { name: 'Nantes', lat: 47.2184, lng: -1.5536 },
  { name: 'Brest', lat: 48.3904, lng: -4.4861 },
  { name: 'Le Havre', lat: 49.4944, lng: 0.1079 },
  { name: 'Calais', lat: 50.9513, lng: 1.8587 },
];

// Spots de surf/kitesurf populaires
const SURF_SPOTS = [
  'Plage des Estagnots',
  'Grande Plage',
  'Plage de la Côte des Basques',
  'Plage de Hossegor',
  'Plage de Lacanau',
  'Plage des Cavaliers',
  'Plage de Plouharnel',
  'Plage de la Torche',
  'Plage de Wissant',
  'Plage de Berck',
];

const BUSINESS_NAMES = [
  'Surf Academy',
  'Kite School Pro',
  'Ocean Adventures',
  'Wave Riders',
  'Blue Water Sports',
  'Atlantic Surf',
  'French Surf School',
  'Pro Kite Center',
  'Surf & Sun',
  'Ocean Spirit',
];

class TestDataGenerator {
  constructor() {
    this.generatedData = {
      users: 0,
      riderProfiles: 0,
      proProfiles: 0,
      proOffers: 0,
      proAvailabilities: 0,
    };
  }

  // Génère une coordonnée aléatoire dans un rayon donné
  getRandomCoordinate(centerLat, centerLng, radiusKm) {
    const radiusInDegrees = radiusKm / 111; // Approximation: 1 degré ≈ 111km
    const u = Math.random();
    const v = Math.random();
    const w = radiusInDegrees * Math.sqrt(u);
    const t = 2 * Math.PI * v;
    const x = w * Math.cos(t);
    const y = w * Math.sin(t);

    return {
      lat: centerLat + x,
      lng: centerLng + y,
    };
  }

  // Génère un email unique
  getRandomEmail(prefix, index) {
    return `${prefix}${index}@test-perf.local`;
  }

  // Génère des utilisateurs et profils riders
  async generateRiderProfiles(count = 100) {
    console.log(`🏄 Génération de ${count} profils riders...`);

    for (let i = 0; i < count; i++) {
      const city = FRENCH_COASTAL_CITIES[Math.floor(Math.random() * FRENCH_COASTAL_CITIES.length)];
      const coordinates = this.getRandomCoordinate(city.lat, city.lng, 50); // Dans un rayon de 50km

      try {
        const user = await prisma.user.create({
          data: {
            email: this.getRandomEmail('test-rider-', Date.now() + i),
            password: '$2b$10$hashedpassword', // Hash fictif
            role: 'RIDER',
            emailVerified: true,
            consentedAt: new Date(),
          },
        });

        await prisma.riderProfile.create({
          data: {
            userId: user.id,
            displayName: `Rider ${i + 1}`,
            bio: `Passionné de surf depuis ${Math.floor(Math.random() * 10) + 1} ans`,
            sex: ['MALE', 'FEMALE', 'OTHER'][Math.floor(Math.random() * 3)],
            maxDistanceKm: Math.floor(Math.random() * 50) + 10,
            lat: coordinates.lat,
            lng: coordinates.lng,
            wantsLesson: Math.random() > 0.5,
            lessonSport: Math.random() > 0.5 ? 'surf' : 'kitesurf',
          },
        });

        this.generatedData.users++;
        this.generatedData.riderProfiles++;

        if (i % 20 === 0) {
          console.log(`  📊 ${i} profils riders créés...`);
        }
      } catch (error) {
        console.warn(`⚠️  Erreur création rider ${i}:`, error.message);
      }
    }

    console.log(`✅ ${this.generatedData.riderProfiles} profils riders créés`);
  }

  // Génère des utilisateurs et profils pros
  async generateProProfiles(count = 30) {
    console.log(`🏄‍♂️ Génération de ${count} profils pros...`);

    for (let i = 0; i < count; i++) {
      const city = FRENCH_COASTAL_CITIES[Math.floor(Math.random() * FRENCH_COASTAL_CITIES.length)];
      const coordinates = this.getRandomCoordinate(city.lat, city.lng, 20); // Dans un rayon de 20km

      try {
        const user = await prisma.user.create({
          data: {
            email: this.getRandomEmail('test-pro-', Date.now() + i),
            password: '$2b$10$hashedpassword', // Hash fictif
            role: 'PRO',
            emailVerified: true,
            consentedAt: new Date(),
          },
        });

        await prisma.proProfile.create({
          data: {
            userId: user.id,
            businessName: BUSINESS_NAMES[Math.floor(Math.random() * BUSINESS_NAMES.length)] + ` ${city.name}`,
            bio: `École de surf professionnelle à ${city.name}. Cours pour tous niveaux.`,
            pricePerHour: Math.floor(Math.random() * 50) + 30, // 30-80€/h
            lat: coordinates.lat,
            lng: coordinates.lng,
            verified: Math.random() > 0.3, // 70% de pros vérifiés
          },
        });

        this.generatedData.users++;
        this.generatedData.proProfiles++;

        if (i % 10 === 0) {
          console.log(`  📊 ${i} profils pros créés...`);
        }
      } catch (error) {
        console.warn(`⚠️  Erreur création pro ${i}:`, error.message);
      }
    }

    console.log(`✅ ${this.generatedData.proProfiles} profils pros créés`);
  }

  // Génère des offres pour les pros
  async generateProOffers(count = 100) {
    console.log(`🏄‍♂️ Génération de ${count} offres pro...`);

    const proProfiles = await prisma.proProfile.findMany({
      where: {
        userId: {
          contains: 'test-pro-',
        },
      },
    });

    if (proProfiles.length === 0) {
      console.warn('⚠️  Aucun profil pro trouvé pour créer des offres');
      return;
    }

    const existingOffers = await prisma.proOffer.findMany({
      where: { proProfileId: { in: proProfiles.map((p) => p.id) } },
      select: { proProfileId: true },
    });
    const takenProfiles = new Set(existingOffers.map((offer) => offer.proProfileId));
    const availableProfiles = proProfiles.filter((profile) => !takenProfiles.has(profile.id));

    if (availableProfiles.length === 0) {
      console.warn('⚠️  Tous les profils pros disposent déjà d\'une offre');
      return;
    }

    // Mélange pour répartir les spots aléatoirement
    availableProfiles.sort(() => Math.random() - 0.5);
    const targetCount = Math.min(count, availableProfiles.length);

    for (let i = 0; i < targetCount; i++) {
      const proProfile = availableProfiles[i];
      const city = FRENCH_COASTAL_CITIES[Math.floor(Math.random() * FRENCH_COASTAL_CITIES.length)];
      const coordinates = this.getRandomCoordinate(city.lat, city.lng, 10);

      try {
        await prisma.proOffer.create({
          data: {
            proProfileId: proProfile.id,
            sport: Math.random() > 0.5 ? 'surf' : 'kitesurf',
            level: ['beginner', 'intermediate', 'advanced'][Math.floor(Math.random() * 3)],
            title: `Cours de ${Math.random() > 0.5 ? 'surf' : 'kitesurf'} - ${city.name}`,
            description: `Cours particulier ou en groupe sur ${SURF_SPOTS[Math.floor(Math.random() * SURF_SPOTS.length)]}`,
            hourlyRate: Math.floor(Math.random() * 60) + 40, // 40-100€
            lat: coordinates.lat,
            lng: coordinates.lng,
            isActive: Math.random() > 0.1, // 90% d'offres actives
          },
        });

        this.generatedData.proOffers++;

        if ((i + 1) % 25 === 0) {
          console.log(`  📊 ${i + 1} offres créées...`);
        }
      } catch (error) {
        console.warn(`⚠️  Erreur création offre ${i}:`, error.message);
      }
    }

    console.log(`✅ ${this.generatedData.proOffers} offres créées`);
  }

  // Génère des disponibilités pour les pros
  async generateProAvailabilities(count = 200) {
    console.log(`📅 Génération de ${count} disponibilités pro...`);

    const users = await prisma.user.findMany({
      where: {
        role: 'PRO',
        email: {
          contains: 'test-pro-',
        },
      },
    });

    if (users.length === 0) {
      console.warn('⚠️  Aucun utilisateur pro trouvé pour créer des disponibilités');
      return;
    }

    for (let i = 0; i < count; i++) {
      const user = users[Math.floor(Math.random() * users.length)];
      const city = FRENCH_COASTAL_CITIES[Math.floor(Math.random() * FRENCH_COASTAL_CITIES.length)];
      const coordinates = this.getRandomCoordinate(city.lat, city.lng, 15);

      // Génère une date dans les 30 prochains jours
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + Math.floor(Math.random() * 30));
      startDate.setHours(8 + Math.floor(Math.random() * 10), 0, 0, 0); // 8h-18h

      const endDate = new Date(startDate);
      endDate.setHours(startDate.getHours() + 1 + Math.floor(Math.random() * 3)); // 1-4h de cours

      try {
        await prisma.proAvailability.create({
          data: {
            proUserId: user.id,
            sport: Math.random() > 0.5 ? 'surf' : 'kitesurf',
            levels: ['beginner', 'intermediate', 'advanced'].slice(0, Math.floor(Math.random() * 3) + 1),
            startAt: startDate,
            endAt: endDate,
            capacity: Math.floor(Math.random() * 5) + 1, // 1-6 personnes
            spotName: SURF_SPOTS[Math.floor(Math.random() * SURF_SPOTS.length)] + ` - ${city.name}`,
            spotLat: coordinates.lat,
            spotLng: coordinates.lng,
            price: Math.floor(Math.random() * 80) + 30, // 30-110€
            status: Math.random() > 0.2 ? 'OPEN' : 'CLOSED', // 80% ouvertes
          },
        });

        this.generatedData.proAvailabilities++;

        if (i % 50 === 0) {
          console.log(`  📊 ${i} disponibilités créées...`);
        }
      } catch (error) {
        console.warn(`⚠️  Erreur création disponibilité ${i}:`, error.message);
      }
    }

    console.log(`✅ ${this.generatedData.proAvailabilities} disponibilités créées`);
  }

  async generateAllTestData() {
    console.log('🚀 Génération des données de test pour PostGIS');
    console.log('===============================================');

    try {
      await this.generateRiderProfiles(150);
      await this.generateProProfiles(40);
      await this.generateProOffers(120);
      await this.generateProAvailabilities(250);

      console.log('\n📊 RÉSUMÉ DE LA GÉNÉRATION');
      console.log('==========================');
      console.log(`👥 Utilisateurs créés: ${this.generatedData.users}`);
      console.log(`🏄 Profils riders: ${this.generatedData.riderProfiles}`);
      console.log(`🏄‍♂️ Profils pros: ${this.generatedData.proProfiles}`);
      console.log(`📋 Offres: ${this.generatedData.proOffers}`);
      console.log(`📅 Disponibilités: ${this.generatedData.proAvailabilities}`);

      console.log('\n🎯 Prêt pour les tests de performance !');
      console.log('Relancez le script test-postgis-performance.js pour voir l\'amélioration');

    } catch (error) {
      console.error('❌ Erreur pendant la génération:', error);
    } finally {
      await prisma.$disconnect();
    }
  }

  async cleanTestData() {
    console.log('🧹 Suppression des données de test...');

    try {
      // Supprime les données dans l'ordre inverse des dépendances
      await prisma.proAvailability.deleteMany({
        where: {
          pro: {
            email: {
              contains: 'test-',
            },
          },
        },
      });

      await prisma.proOffer.deleteMany({
        where: {
          proProfile: {
            user: {
              email: {
                contains: 'test-',
              },
            },
          },
        },
      });

      await prisma.proProfile.deleteMany({
        where: {
          user: {
            email: {
              contains: 'test-',
            },
          },
        },
      });

      await prisma.riderProfile.deleteMany({
        where: {
          user: {
            email: {
              contains: 'test-',
            },
          },
        },
      });

      await prisma.user.deleteMany({
        where: {
          email: {
            contains: 'test-',
          },
        },
      });

      console.log('✅ Données de test supprimées');

    } catch (error) {
      console.error('❌ Erreur pendant la suppression:', error);
    } finally {
      await prisma.$disconnect();
    }
  }
}

// Exécution du script
if (require.main === module) {
  const generator = new TestDataGenerator();

  const command = process.argv[2];

  if (command === 'clean') {
    generator.cleanTestData().catch(console.error);
  } else {
    generator.generateAllTestData().catch(console.error);
  }
}

module.exports = TestDataGenerator;
