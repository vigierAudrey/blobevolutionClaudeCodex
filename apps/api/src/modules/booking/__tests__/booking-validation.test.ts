import { beforeEach, afterEach, describe, it, expect } from '@jest/globals';
import { prisma } from '@blobinfini/database';
import { BookingService } from '../booking.service';

const bookingService = new BookingService();

describe('BookingService Validation', () => {
  let testProUserId: string;
  let anotherProUserId: string;

  beforeEach(async () => {
    // Create test users
    const testPro = await prisma.user.create({
      data: {
        email: 'test-pro@validation.test',
        password: 'test-password',
        role: 'PRO',
        emailVerified: true
      }
    });
    testProUserId = testPro.id;

    const anotherPro = await prisma.user.create({
      data: {
        email: 'another-pro@validation.test',
        password: 'test-password',
        role: 'PRO',
        emailVerified: true
      }
    });
    anotherProUserId = anotherPro.id;
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.proAvailability.deleteMany({
      where: { proUserId: { in: [testProUserId, anotherProUserId] } }
    });

    await prisma.user.deleteMany({
      where: { id: { in: [testProUserId, anotherProUserId] } }
    });
  });

  describe('Geographic validation', () => {
    it('should accept valid coordinates', async () => {
      const validData = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        spotLat: 43.5,
        spotLng: -1.5,
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, validData))
        .resolves.not.toThrow();
    });

    it('should reject invalid latitude (too high)', async () => {
      const invalidData = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        spotLat: 91, // Invalid: > 90
        spotLng: -1.5,
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, invalidData))
        .rejects.toThrow('Invalid latitude: must be between -90 and 90');
    });

    it('should reject invalid latitude (too low)', async () => {
      const invalidData = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        spotLat: -91, // Invalid: < -90
        spotLng: -1.5,
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, invalidData))
        .rejects.toThrow('Invalid latitude: must be between -90 and 90');
    });

    it('should reject invalid longitude (too high)', async () => {
      const invalidData = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        spotLat: 43.5,
        spotLng: 181, // Invalid: > 180
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, invalidData))
        .rejects.toThrow('Invalid longitude: must be between -180 and 180');
    });

    it('should reject invalid longitude (too low)', async () => {
      const invalidData = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        spotLat: 43.5,
        spotLng: -181, // Invalid: < -180
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, invalidData))
        .rejects.toThrow('Invalid longitude: must be between -180 and 180');
    });
  });

  describe('Time overlap validation', () => {
    it('should create availability when no overlap exists', async () => {
      // Create first availability
      const firstAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T09:00:00Z'),
        endAt: new Date('2024-12-01T11:00:00Z'),
        capacity: 1
      };

      await bookingService.createAvailability(testProUserId, firstAvailability);

      // Create second availability (no overlap)
      const secondAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T12:00:00Z'),
        endAt: new Date('2024-12-01T14:00:00Z'),
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, secondAvailability))
        .resolves.not.toThrow();
    });

    it('should reject overlapping availabilities (complete overlap)', async () => {
      // Create first availability
      const firstAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        capacity: 1
      };

      await bookingService.createAvailability(testProUserId, firstAvailability);

      // Try to create overlapping availability
      const overlappingAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, overlappingAvailability))
        .rejects.toThrow('Time overlap detected');
    });

    it('should reject overlapping availabilities (partial overlap - start)', async () => {
      // Create first availability
      const firstAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        capacity: 1
      };

      await bookingService.createAvailability(testProUserId, firstAvailability);

      // Try to create overlapping availability (starts before, ends during)
      const overlappingAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T09:00:00Z'),
        endAt: new Date('2024-12-01T11:00:00Z'),
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, overlappingAvailability))
        .rejects.toThrow('Time overlap detected');
    });

    it('should reject overlapping availabilities (partial overlap - end)', async () => {
      // Create first availability
      const firstAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        capacity: 1
      };

      await bookingService.createAvailability(testProUserId, firstAvailability);

      // Try to create overlapping availability (starts during, ends after)
      const overlappingAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T11:00:00Z'),
        endAt: new Date('2024-12-01T13:00:00Z'),
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, overlappingAvailability))
        .rejects.toThrow('Time overlap detected');
    });

    it('should reject overlapping availabilities (containing overlap)', async () => {
      // Create first availability
      const firstAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:30:00Z'),
        endAt: new Date('2024-12-01T11:30:00Z'),
        capacity: 1
      };

      await bookingService.createAvailability(testProUserId, firstAvailability);

      // Try to create containing availability
      const containingAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, containingAvailability))
        .rejects.toThrow('Time overlap detected');
    });

    it('should reject if start time is after end time', async () => {
      const invalidTimeData = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T12:00:00Z'),
        endAt: new Date('2024-12-01T10:00:00Z'), // End before start
        capacity: 1
      };

      await expect(bookingService.createAvailability(testProUserId, invalidTimeData))
        .rejects.toThrow('Start time must be before end time');
    });

    it('should allow different pros to have overlapping times', async () => {

      // Create availability for first pro
      const firstProAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        capacity: 1
      };

      await bookingService.createAvailability(testProUserId, firstProAvailability);

      // Create overlapping availability for second pro (should be allowed)
      const secondProAvailability = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        capacity: 1
      };

      await expect(bookingService.createAvailability(anotherProUserId, secondProAvailability))
        .resolves.not.toThrow();
    });
  });

  describe('Update availability validation', () => {
    it('should allow updating when no new overlap is created', async () => {
      // Create initial availability
      const initialData = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        spotLat: 43.5,
        spotLng: -1.5,
        capacity: 1
      };

      const availability = await bookingService.createAvailability(testProUserId, initialData);

      // Update without creating overlap
      const updateData = {
        capacity: 2,
        spotName: 'Updated Spot'
      };

      await expect(bookingService.updateAvailability(testProUserId, availability.id, updateData))
        .resolves.not.toThrow();
    });

    it('should reject update that creates time overlap', async () => {
      // Create first availability
      const firstData = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        capacity: 1
      };

      const firstAvailability = await bookingService.createAvailability(testProUserId, firstData);

      // Create second availability
      const secondData = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T14:00:00Z'),
        endAt: new Date('2024-12-01T16:00:00Z'),
        capacity: 1
      };

      await bookingService.createAvailability(testProUserId, secondData);

      // Try to update first to overlap with second
      const conflictingUpdate = {
        startAt: new Date('2024-12-01T13:00:00Z'),
        endAt: new Date('2024-12-01T15:00:00Z')
      };

      await expect(bookingService.updateAvailability(testProUserId, firstAvailability.id, conflictingUpdate))
        .rejects.toThrow('Time overlap detected');
    });

    it('should reject update with invalid coordinates', async () => {
      // Create initial availability
      const initialData = {
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date('2024-12-01T10:00:00Z'),
        endAt: new Date('2024-12-01T12:00:00Z'),
        spotLat: 43.5,
        spotLng: -1.5,
        capacity: 1
      };

      const availability = await bookingService.createAvailability(testProUserId, initialData);

      // Try to update with invalid coordinates
      const invalidUpdate = {
        spotLat: 91 // Invalid latitude
      };

      await expect(bookingService.updateAvailability(testProUserId, availability.id, invalidUpdate))
        .rejects.toThrow('Invalid latitude: must be between -90 and 90');
    });
  });
});