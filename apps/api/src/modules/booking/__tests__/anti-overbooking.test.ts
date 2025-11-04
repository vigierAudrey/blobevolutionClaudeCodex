import { clientPrisma as prisma, BookingRequestStatus } from '@blobinfini/database';
import { bookingService } from '../booking.service';

describe('Système anti-overbooking et gestion des capacités', () => {
  let proUserId: string;
  let riderUserId1: string;
  let riderUserId2: string;
  let riderUserId3: string;
  let availabilityId: string;

  beforeAll(async () => {
    // Nettoyer les données
    await prisma.booking.deleteMany();
    await prisma.bookingRequest.deleteMany();
    await prisma.proAvailability.deleteMany();
    await prisma.riderProfile.deleteMany();
    await prisma.proProfile.deleteMany();
    await prisma.user.deleteMany();

    // Créer des utilisateurs de test
    const proUser = await prisma.user.create({
      data: { email: 'pro-overbooking@test.com', password: 'testpass', role: 'PRO', emailVerified: true },
    });
    proUserId = proUser.id;

    const rider1 = await prisma.user.create({
      data: { email: 'rider1-overbooking@test.com', password: 'testpass', emailVerified: true },
    });
    riderUserId1 = rider1.id;

    const rider2 = await prisma.user.create({
      data: { email: 'rider2-overbooking@test.com', password: 'testpass', emailVerified: true },
    });
    riderUserId2 = rider2.id;

    const rider3 = await prisma.user.create({
      data: { email: 'rider3-overbooking@test.com', password: 'testpass', emailVerified: true },
    });
    riderUserId3 = rider3.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Gestion des capacités', () => {
    beforeEach(async () => {
      await prisma.booking.deleteMany();
      await prisma.bookingRequest.deleteMany();
      await prisma.proAvailability.deleteMany();
    });

    it('devrait créer une availability avec capacité définie', async () => {
      const availability = await bookingService.createAvailability(proUserId, {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date(Date.now() + 60 * 60 * 1000),
        endAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 2,
        spotName: 'Test Spot',
        spotLat: 43.4832,
        spotLng: -1.5586,
      });

      expect(availability.capacity).toBe(2);
      expect(availability.bookedCount).toBe(0);
      expect(availability.status).toBe('OPEN');
      availabilityId = availability.id;
    });

    it('devrait permettre des réservations jusqu\'à la capacité maximum', async () => {
      // Créer une nouvelle availability pour ce test
      const availability = await bookingService.createAvailability(proUserId, {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date(Date.now() + 60 * 60 * 1000),
        endAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 2,
        spotName: 'Test Capacity',
        spotLat: 43.4832,
        spotLng: -1.5586,
      });

      // Créer 2 demandes de réservation
      const request1 = await bookingService.createRequest(riderUserId1, {
        availabilityId: availability.id,
        message: 'Première demande',
      });

      const request2 = await bookingService.createRequest(riderUserId2, {
        availabilityId: availability.id,
        message: 'Deuxième demande',
      });

      // Accepter la première demande
      await bookingService.decideRequest(proUserId, request1.id, 'accept');

      // Vérifier que la capacité est mise à jour
      let updatedAvailability = await prisma.proAvailability.findUnique({
        where: { id: availability.id },
      });
      expect(updatedAvailability!.bookedCount).toBe(1);
      expect(updatedAvailability!.status).toBe('OPEN');

      // Accepter la deuxième demande
      await bookingService.decideRequest(proUserId, request2.id, 'accept');

      // Vérifier que la capacité est atteinte et le statut fermé
      updatedAvailability = await prisma.proAvailability.findUnique({
        where: { id: availability.id },
      });
      expect(updatedAvailability!.bookedCount).toBe(2);
      expect(updatedAvailability!.status).toBe('CLOSED');
    });

    it('devrait empêcher l\'overbooking quand la capacité est atteinte', async () => {
      // Créer une availability avec capacité 2 et la remplir
      const availability = await bookingService.createAvailability(proUserId, {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date(Date.now() + 60 * 60 * 1000),
        endAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 2,
        spotName: 'Test Overbooking',
        spotLat: 43.4832,
        spotLng: -1.5586,
      });

      // Créer et accepter 2 demandes pour remplir la capacité
      const request1 = await bookingService.createRequest(riderUserId1, {
        availabilityId: availability.id,
        message: 'Première demande',
      });
      const request2 = await bookingService.createRequest(riderUserId2, {
        availabilityId: availability.id,
        message: 'Deuxième demande',
      });

      await bookingService.decideRequest(proUserId, request1.id, 'accept');
      await bookingService.decideRequest(proUserId, request2.id, 'accept');

      // Créer une troisième demande
      const request3 = await bookingService.createRequest(riderUserId3, {
        availabilityId: availability.id,
        message: 'Troisième demande (overflow)',
      });

      // Tenter d'accepter la troisième demande doit échouer
      await expect(
        bookingService.decideRequest(proUserId, request3.id, 'accept')
      ).rejects.toMatchObject({
        message: 'Availability capacity reached',
        status: 409,
      });

      // Vérifier que la capacité n'a pas changé
      const finalAvailability = await prisma.proAvailability.findUnique({
        where: { id: availability.id },
      });
      expect(finalAvailability!.bookedCount).toBe(2);
      expect(finalAvailability!.status).toBe('CLOSED');
    });

    it('devrait rejeter les demandes sur une availability fermée', async () => {
      // Créer une availability et la fermer en atteignant la capacité
      const availability = await bookingService.createAvailability(proUserId, {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date(Date.now() + 60 * 60 * 1000),
        endAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 1,
        spotName: 'Test Closed',
        spotLat: 43.4832,
        spotLng: -1.5586,
      });

      // Remplir la capacité
      const request1 = await bookingService.createRequest(riderUserId1, {
        availabilityId: availability.id,
        message: 'Première demande',
      });
      await bookingService.decideRequest(proUserId, request1.id, 'accept');

      // Créer une nouvelle demande sur l'availability fermée
      const request4 = await bookingService.createRequest(riderUserId2, {
        availabilityId: availability.id,
        message: 'Demande sur slot fermé',
      });

      // Tenter d'accepter doit échouer
      await expect(
        bookingService.decideRequest(proUserId, request4.id, 'accept')
      ).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe('Scénarios de concurrence et locks', () => {
    beforeEach(async () => {
      await prisma.booking.deleteMany();
      await prisma.bookingRequest.deleteMany();
      await prisma.proAvailability.deleteMany();

      // Créer une nouvelle availability avec capacité 1
      const availability = await bookingService.createAvailability(proUserId, {
        sport: 'kitesurf',
        levels: ['intermediate'],
        startAt: new Date(Date.now() + 60 * 60 * 1000),
        endAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 1,
        spotName: 'Concurrent Test Spot',
        spotLat: 43.4832,
        spotLng: -1.5586,
      });
      availabilityId = availability.id;
    });

    it('devrait gérer les accès concurrents avec le lock FOR UPDATE', async () => {
      // Créer deux demandes simultanées
      const request1 = await bookingService.createRequest(riderUserId1, {
        availabilityId,
        message: 'Demande concurrente 1',
      });

      const request2 = await bookingService.createRequest(riderUserId2, {
        availabilityId,
        message: 'Demande concurrente 2',
      });

      // Simuler des acceptations concurrentes
      const [result1, result2] = await Promise.allSettled([
        bookingService.decideRequest(proUserId, request1.id, 'accept'),
        bookingService.decideRequest(proUserId, request2.id, 'accept'),
      ]);

      // Une des deux doit réussir, l'autre doit échouer
      const successes = [result1, result2].filter(r => r.status === 'fulfilled');
      const failures = [result1, result2].filter(r => r.status === 'rejected');

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      // Vérifier l'état final
      const availability = await prisma.proAvailability.findUnique({
        where: { id: availabilityId },
      });
      expect(availability!.bookedCount).toBe(1);
      expect(availability!.status).toBe('CLOSED');

      // Vérifier qu'il n'y a qu'un seul booking créé
      const bookings = await prisma.booking.findMany({
        where: { availabilityId },
      });
      expect(bookings).toHaveLength(1);
    });

    it('devrait empêcher la double acceptation de la même demande', async () => {
      const request = await bookingService.createRequest(riderUserId1, {
        availabilityId,
        message: 'Demande double acceptation',
      });

      // Première acceptation
      await bookingService.decideRequest(proUserId, request.id, 'accept');

      // Deuxième tentative d'acceptation doit échouer
      await expect(
        bookingService.decideRequest(proUserId, request.id, 'accept')
      ).rejects.toMatchObject({
        message: 'Request already handled',
        status: 409,
      });

      // Vérifier qu'il n'y a qu'un seul booking
      const bookings = await prisma.booking.findMany({
        where: { availabilityId },
      });
      expect(bookings).toHaveLength(1);
    });
  });

  describe('Validation des contraintes de réservation', () => {
    beforeEach(async () => {
      await prisma.booking.deleteMany();
      await prisma.bookingRequest.deleteMany();
      await prisma.proAvailability.deleteMany();
    });

    it('devrait valider les chevauchements de créneaux', async () => {
      const baseTime = Date.now() + 60 * 60 * 1000;

      // Créer un premier créneau
      await bookingService.createAvailability(proUserId, {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date(baseTime),
        endAt: new Date(baseTime + 60 * 60 * 1000), // 1h
        capacity: 3,
        spotName: 'Test Overlap',
        spotLat: 43.4832,
        spotLng: -1.5586,
      });

      // Tenter de créer un créneau qui chevauche
      await expect(
        bookingService.createAvailability(proUserId, {
          sport: 'surf',
          levels: ['intermediate'],
          startAt: new Date(baseTime + 30 * 60 * 1000), // 30min plus tard
          endAt: new Date(baseTime + 90 * 60 * 1000), // 1h30 plus tard
          capacity: 2,
          spotName: 'Test Overlap 2',
          spotLat: 43.4832,
          spotLng: -1.5586,
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining('Time overlap detected'),
        status: 409,
      });
    });

    it('devrait valider les coordonnées géographiques', async () => {
      await expect(
        bookingService.createAvailability(proUserId, {
          sport: 'surf',
          levels: ['beginner'],
          startAt: new Date(Date.now() + 60 * 60 * 1000),
          endAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          capacity: 2,
          spotName: 'Invalid Coords',
          spotLat: 91, // Invalide : > 90
          spotLng: -1.5586,
        })
      ).rejects.toMatchObject({
        message: 'Invalid latitude: must be between -90 and 90',
        status: 400,
      });

      await expect(
        bookingService.createAvailability(proUserId, {
          sport: 'surf',
          levels: ['beginner'],
          startAt: new Date(Date.now() + 60 * 60 * 1000),
          endAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          capacity: 2,
          spotName: 'Invalid Coords',
          spotLat: 43.4832,
          spotLng: 181, // Invalide : > 180
        })
      ).rejects.toMatchObject({
        message: 'Invalid longitude: must be between -180 and 180',
        status: 400,
      });
    });

    it('devrait valider les horaires de début et fin', async () => {
      const baseTime = Date.now() + 60 * 60 * 1000;

      await expect(
        bookingService.createAvailability(proUserId, {
          sport: 'surf',
          levels: ['beginner'],
          startAt: new Date(baseTime + 60 * 60 * 1000), // Fin avant début
          endAt: new Date(baseTime),
          capacity: 2,
          spotName: 'Invalid Times',
          spotLat: 43.4832,
          spotLng: -1.5586,
        })
      ).rejects.toMatchObject({
        message: 'Start time must be before end time',
        status: 400,
      });
    });
  });

  describe('Tests de performance et stress', () => {
    beforeEach(async () => {
      await prisma.booking.deleteMany();
      await prisma.bookingRequest.deleteMany();
      await prisma.proAvailability.deleteMany();
    });

    it('devrait gérer un grand nombre de demandes simultanées', async () => {
      // Créer une availability avec capacité importante
      const availability = await bookingService.createAvailability(proUserId, {
        sport: 'surf',
        levels: ['beginner', 'intermediate'],
        startAt: new Date(Date.now() + 60 * 60 * 1000),
        endAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        capacity: 10,
        spotName: 'Stress Test Spot',
        spotLat: 43.4832,
        spotLng: -1.5586,
      });

      // Créer plusieurs utilisateurs et demandes
      const riders = await Promise.all(
        Array.from({ length: 15 }, async (_, i) => {
          return prisma.user.create({
            data: {
              email: `stress-rider-${i}@test.com`,
              password: 'testpass',
              emailVerified: true
            },
          });
        })
      );

      // Créer toutes les demandes
      const requests = await Promise.all(
        riders.map(rider =>
          bookingService.createRequest(rider.id, {
            availabilityId: availability.id,
            message: `Demande du rider ${rider.email}`,
          })
        )
      );

      // Mesurer le temps d'exécution
      const startTime = Date.now();

      // Accepter toutes les demandes en parallèle
      const results = await Promise.allSettled(
        requests.map(request =>
          bookingService.decideRequest(proUserId, request.id, 'accept')
        )
      );

      const executionTime = Date.now() - startTime;

      // Vérifier que le nombre d'acceptations ne dépasse pas la capacité
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');

      expect(successes.length).toBeLessThanOrEqual(10);
      expect(successes.length).toBeGreaterThan(0);
      expect(executionTime).toBeLessThan(5000); // Moins de 5 secondes

      // Vérifier l'état final de l'availability
      const finalAvailability = await prisma.proAvailability.findUnique({
        where: { id: availability.id },
      });
      expect(finalAvailability!.bookedCount).toBeLessThanOrEqual(10);
      expect(finalAvailability!.bookedCount).toBe(successes.length);

      // Vérifier le nombre de bookings créés
      const bookings = await prisma.booking.findMany({
        where: { availabilityId: availability.id },
      });
      expect(bookings.length).toBe(finalAvailability!.bookedCount);
    });

    it('devrait maintenir la cohérence lors de pics de charge', async () => {
      // Test avec capacité réduite pour forcer les conflits
      const availability = await bookingService.createAvailability(proUserId, {
        sport: 'kitesurf',
        levels: ['advanced'],
        startAt: new Date(Date.now() + 60 * 60 * 1000),
        endAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 3,
        spotName: 'Load Test Spot',
        spotLat: 43.4832,
        spotLng: -1.5586,
      });

      // Créer 20 demandes simultanées pour 3 places
      const riders = await Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          return prisma.user.create({
            data: {
              email: `load-rider-${i}@test.com`,
              password: 'testpass',
              emailVerified: true
            },
          });
        })
      );

      const requests = await Promise.all(
        riders.map(rider =>
          bookingService.createRequest(rider.id, {
            availabilityId: availability.id,
            message: `Demande load test`,
          })
        )
      );

      // Accepter toutes les demandes en parallèle
      const results = await Promise.allSettled(
        requests.map(request =>
          bookingService.decideRequest(proUserId, request.id, 'accept')
        )
      );

      // Au maximum 3 doivent réussir (capacité)
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');

      expect(successes.length).toBeLessThanOrEqual(3);
      expect(successes.length).toBeGreaterThan(0);

      // Vérifier la cohérence des données
      const finalAvailability = await prisma.proAvailability.findUnique({
        where: { id: availability.id },
      });
      const bookings = await prisma.booking.findMany({
        where: { availabilityId: availability.id },
      });

      expect(finalAvailability!.bookedCount).toBeLessThanOrEqual(3);
      expect(finalAvailability!.bookedCount).toBe(successes.length);
      expect(bookings.length).toBe(finalAvailability!.bookedCount);

      // Vérifier qu'il n'y a pas de doublons
      const uniqueRiders = new Set(bookings.map(b => b.riderUserId));
      expect(uniqueRiders.size).toBe(bookings.length);
    });
  });
});
