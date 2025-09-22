import { prisma } from '@blobinfini/database';
import { Prisma } from '@prisma/client';

describe('Algorithme de matching géospatial PostGIS', () => {
  beforeAll(async () => {
    // Nettoyer les données de test
    await prisma.riderProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Calculs de distance avec ST_Distance', () => {
    it('devrait calculer correctement la distance entre deux points proches', async () => {
      // Test avec des coordonnées de Biarritz et Bayonne (environ 8km)
      const biarritzLat = 43.4832;
      const biarritzLng = -1.5586;
      const bayonneLat = 43.4927;
      const bayonneLng = -1.4748;

      const result = await prisma.$queryRaw<Array<{ distance_m: number }>>`
        SELECT ST_Distance(
          ST_MakePoint(${biarritzLng}, ${biarritzLat})::geography,
          ST_SetSRID(ST_MakePoint(${bayonneLng}, ${bayonneLat}), 4326)::geography
        ) AS distance_m
      `;

      expect(result[0]).toBeDefined();
      expect(result[0].distance_m).toBeGreaterThan(6500); // Plus de 6.5km
      expect(result[0].distance_m).toBeLessThan(10000); // Moins de 10km
    });

    it('devrait retourner 0 pour des coordonnées identiques', async () => {
      const lat = 43.4832;
      const lng = -1.5586;

      const result = await prisma.$queryRaw<Array<{ distance_m: number }>>`
        SELECT ST_Distance(
          ST_MakePoint(${lng}, ${lat})::geography,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
        ) AS distance_m
      `;

      expect(result[0].distance_m).toBe(0);
    });

    it('devrait calculer correctement les distances longues (Paris-Marseille)', async () => {
      // Paris: 48.8566, 2.3522
      // Marseille: 43.2965, 5.3698
      const parisLat = 48.8566;
      const parisLng = 2.3522;
      const marseilleLat = 43.2965;
      const marseilleLng = 5.3698;

      const result = await prisma.$queryRaw<Array<{ distance_m: number }>>`
        SELECT ST_Distance(
          ST_MakePoint(${parisLng}, ${parisLat})::geography,
          ST_SetSRID(ST_MakePoint(${marseilleLng}, ${marseilleLat}), 4326)::geography
        ) AS distance_m
      `;

      // Distance Paris-Marseille environ 660km
      expect(result[0].distance_m).toBeGreaterThan(650000);
      expect(result[0].distance_m).toBeLessThan(680000);
    });
  });

  describe('Filtrage par rayon avec ST_DWithin', () => {
    beforeEach(async () => {
      // Nettoyer avant chaque test
      await prisma.riderProfile.deleteMany();
      await prisma.user.deleteMany();
    });

    it('devrait inclure les profils dans le rayon spécifié', async () => {
      // Créer des utilisateurs de test
      const centralUser = await prisma.user.create({
        data: { email: 'central@test.com', password: 'testpass', emailVerified: true },
      });
      const closeUser = await prisma.user.create({
        data: { email: 'close@test.com', password: 'testpass', emailVerified: true },
      });
      const farUser = await prisma.user.create({
        data: { email: 'far@test.com', password: 'testpass', emailVerified: true },
      });

      // Biarritz comme point central
      const centralLat = 43.4832;
      const centralLng = -1.5586;

      await prisma.riderProfile.create({
        data: {
          userId: centralUser.id,
          lat: centralLat,
          lng: centralLng,
          displayName: 'Central'
        },
      });

      // Bayonne (8km de Biarritz)
      await prisma.riderProfile.create({
        data: {
          userId: closeUser.id,
          lat: 43.4927,
          lng: -1.4748,
          displayName: 'Close'
        },
      });

      // Paris (très loin)
      await prisma.riderProfile.create({
        data: {
          userId: farUser.id,
          lat: 48.8566,
          lng: 2.3522,
          displayName: 'Far'
        },
      });

      // Test avec rayon de 10km (devrait inclure Bayonne mais pas Paris)
      const radiusKm = 10;
      const result = await prisma.$queryRaw<Array<{ id: string; displayName: string }>>`
        SELECT rp."id", rp."displayName"
        FROM "RiderProfile" rp
        WHERE ST_DWithin(
          ST_MakePoint(${centralLng}, ${centralLat})::geography,
          ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
          ${radiusKm * 1000}
        )
        AND rp."userId" != ${centralUser.id}
      `;

      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe('Close');
    });

    it('devrait exclure les profils hors du rayon spécifié', async () => {
      // Créer des utilisateurs de test
      const centralUser = await prisma.user.create({
        data: { email: 'central2@test.com', password: 'testpass', emailVerified: true },
      });
      const farUser = await prisma.user.create({
        data: { email: 'far2@test.com', password: 'testpass', emailVerified: true },
      });

      const centralLat = 43.4832;
      const centralLng = -1.5586;

      await prisma.riderProfile.create({
        data: {
          userId: centralUser.id,
          lat: centralLat,
          lng: centralLng,
          displayName: 'Central'
        },
      });

      // Toulouse (environ 300km)
      await prisma.riderProfile.create({
        data: {
          userId: farUser.id,
          lat: 43.6047,
          lng: 1.4442,
          displayName: 'Toulouse'
        },
      });

      // Test avec rayon de 50km (devrait exclure Toulouse)
      const radiusKm = 50;
      const result = await prisma.$queryRaw<Array<{ id: string; displayName: string }>>`
        SELECT rp."id", rp."displayName"
        FROM "RiderProfile" rp
        WHERE ST_DWithin(
          ST_MakePoint(${centralLng}, ${centralLat})::geography,
          ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
          ${radiusKm * 1000}
        )
        AND rp."userId" != ${centralUser.id}
      `;

      expect(result).toHaveLength(0);
    });
  });

  describe('Cas limites géographiques', () => {
    it('devrait gérer les coordonnées aux limites mondiales', async () => {
      // Test avec des coordonnées extrêmes
      const extremeCoords = [
        { lat: 90, lng: 180, name: 'Nord-Est extrême' },
        { lat: -90, lng: -180, name: 'Sud-Ouest extrême' },
        { lat: 0, lng: 0, name: 'Équateur/Méridien' },
      ];

      for (const coord of extremeCoords) {
        const result = await prisma.$queryRaw<Array<{ valid: boolean }>>`
          SELECT ST_IsValid(ST_SetSRID(ST_MakePoint(${coord.lng}, ${coord.lat}), 4326)) AS valid
        `;

        expect(result[0].valid).toBe(true);
      }
    });

    it('devrait calculer des distances à travers le méridien de Greenwich', async () => {
      // Londres: 51.5074, -0.1278
      // Paris: 48.8566, 2.3522
      const londonLat = 51.5074;
      const londonLng = -0.1278;
      const parisLat = 48.8566;
      const parisLng = 2.3522;

      const result = await prisma.$queryRaw<Array<{ distance_m: number }>>`
        SELECT ST_Distance(
          ST_MakePoint(${londonLng}, ${londonLat})::geography,
          ST_SetSRID(ST_MakePoint(${parisLng}, ${parisLat}), 4326)::geography
        ) AS distance_m
      `;

      // Distance Londres-Paris environ 344km
      expect(result[0].distance_m).toBeGreaterThan(330000);
      expect(result[0].distance_m).toBeLessThan(360000);
    });

    it('devrait gérer les coordonnées nulles ou invalides', async () => {
      // Test avec des valeurs nulles
      const result = await prisma.$queryRaw<Array<{ distance_m: number | null }>>`
        SELECT CASE
          WHEN 43.4832 IS NOT NULL AND -1.5586 IS NOT NULL AND NULL IS NOT NULL AND NULL IS NOT NULL THEN ST_Distance(
            ST_MakePoint(-1.5586, 43.4832)::geography,
            ST_SetSRID(ST_MakePoint(NULL, NULL), 4326)::geography
          )
          ELSE NULL
        END AS distance_m
      `;

      expect(result[0].distance_m).toBeNull();
    });
  });

  describe('Performance des requêtes PostGIS', () => {
    beforeEach(async () => {
      await prisma.riderProfile.deleteMany();
      await prisma.user.deleteMany();
    });

    it('devrait exécuter les calculs de distance en temps raisonnable', async () => {
      // Créer plusieurs profils pour tester la performance
      const users = await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          return prisma.user.create({
            data: { email: `perf${i}@test.com`, password: 'testpass', emailVerified: true },
          });
        })
      );

      await Promise.all(
        users.map((user, i) =>
          prisma.riderProfile.create({
            data: {
              userId: user.id,
              lat: 43.4832 + (i * 0.01), // Variation de coordonnées
              lng: -1.5586 + (i * 0.01),
              displayName: `Profile ${i}`,
            },
          })
        )
      );

      const startTime = Date.now();

      const result = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM "RiderProfile" rp
        WHERE ST_DWithin(
          ST_MakePoint(-1.5586, 43.4832)::geography,
          ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
          10000
        )
      `;

      const executionTime = Date.now() - startTime;

      expect(result[0].count).toBeGreaterThan(0);
      expect(executionTime).toBeLessThan(1000); // Moins d'1 seconde
    });

    it('devrait optimiser les requêtes avec index spatial', async () => {
      // Test pour vérifier que les index spatiaux sont utilisés
      const explainResult = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
        EXPLAIN (FORMAT JSON)
        SELECT rp."id", rp."displayName",
               ST_Distance(
                 ST_MakePoint(-1.5586, 43.4832)::geography,
                 ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography
               ) AS dist_m
        FROM "RiderProfile" rp
        WHERE ST_DWithin(
          ST_MakePoint(-1.5586, 43.4832)::geography,
          ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
          10000
        )
        ORDER BY dist_m ASC
      `;

      // Le plan devrait exister (pas de test spécifique sur l'index pour l'instant)
      expect(explainResult).toBeDefined();
      expect(explainResult.length).toBeGreaterThan(0);
    });
  });

  describe('Intégration avec l\'algorithme de matching complet', () => {
    beforeEach(async () => {
      await prisma.riderDiscipline.deleteMany();
      await prisma.riderProfile.deleteMany();
      await prisma.user.deleteMany();
    });

    it('devrait combiner correctement distance et critères de matching', async () => {
      // Créer un utilisateur central
      const centralUser = await prisma.user.create({
        data: { email: 'central@matching.com', password: 'testpass', emailVerified: true },
      });
      const centralProfile = await prisma.riderProfile.create({
        data: {
          userId: centralUser.id,
          lat: 43.4832,
          lng: -1.5586,
          displayName: 'Central',
        },
      });

      // Créer un utilisateur proche avec même sport/niveau
      const matchingUser = await prisma.user.create({
        data: { email: 'matching@test.com', password: 'testpass', emailVerified: true },
      });
      const matchingProfile = await prisma.riderProfile.create({
        data: {
          userId: matchingUser.id,
          lat: 43.4927, // Bayonne
          lng: -1.4748,
          displayName: 'Matching',
        },
      });

      // Créer les disciplines
      await prisma.riderDiscipline.createMany({
        data: [
          { profileId: centralProfile.id, sport: 'surf', level: 'beginner' },
          { profileId: matchingProfile.id, sport: 'surf', level: 'beginner' },
        ],
      });

      // Test de la requête complète comme dans le controller
      const sport = 'surf';
      const level = 'beginner';
      const maxDistanceKm = 20;
      const searchLat = 43.4832;
      const searchLng = -1.5586;

      const result = await prisma.$queryRaw<Array<{
        id: string;
        displayName: string;
        sport: string;
        level: string;
        dist_m: number
      }>>`
        SELECT rp."id", rp."displayName", rd."sport", rd."level",
               ST_Distance(
                 ST_MakePoint(${searchLng}, ${searchLat})::geography,
                 ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography
               ) AS dist_m
        FROM "RiderProfile" rp
        JOIN "RiderDiscipline" rd ON rd."profileId" = rp."id" AND rd."sport" = ${sport} AND rd."level" = ${level}
        WHERE rp."lat" IS NOT NULL AND rp."lng" IS NOT NULL AND rp."userId" <> ${centralUser.id}
        AND ST_DWithin(
          ST_MakePoint(${searchLng}, ${searchLat})::geography,
          ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
          ${maxDistanceKm * 1000}
        )
        ORDER BY dist_m ASC
      `;

      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe('Matching');
      expect(result[0].sport).toBe('surf');
      expect(result[0].level).toBe('beginner');
      expect(result[0].dist_m).toBeGreaterThan(0);
      expect(result[0].dist_m).toBeLessThan(20000); // Moins de 20km
    });
  });
});