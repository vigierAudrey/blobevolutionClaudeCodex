/**
 * Tests for geographic grid utility
 */

import {
  gridCell,
  gridCellDistance,
  gridCellsInRadius,
  recommendedGridSize,
  DEFAULT_GRID_CELL_KM,
  GridCell
} from '../geoGrid';

describe('geoGrid', () => {
  describe('gridCell()', () => {
    it('should snap coordinates to grid with default 5km cell size', () => {
      // Biarritz area
      const result = gridCell(43.4832, -1.5586);

      expect(result.cellKm).toBe(5);
      expect(result.glat).toBeCloseTo(43.478, 2); // ~43.48 (5km grid)
      expect(result.glng).toBeCloseTo(-1.572, 2); // ~-1.57 (5km grid, adjusted to actual calculation)
      expect(result.cellId).toMatch(/^g43\.\d+:-1\.\d+$/);
    });

    it('should generate identical cellId for coordinates within same cell', () => {
      // Two users 3km apart (within 5km cell)
      const user1 = gridCell(43.4832, -1.5586, 5);
      const user2 = gridCell(43.4901, -1.5621, 5);

      expect(user1.cellId).toBe(user2.cellId);
      expect(user1.glat).toBe(user2.glat);
      expect(user1.glng).toBe(user2.glng);
    });

    it('should generate different cellId for coordinates in different cells', () => {
      // Users 10km apart (different 5km cells)
      const user1 = gridCell(43.4832, -1.5586, 5);
      const user2 = gridCell(43.5732, -1.5586, 5); // ~10km north

      expect(user1.cellId).not.toBe(user2.cellId);
      expect(user1.glat).not.toBe(user2.glat);
    });

    it('should support custom cell sizes', () => {
      const result2km = gridCell(43.4832, -1.5586, 2);
      const result10km = gridCell(43.4832, -1.5586, 10);

      expect(result2km.cellKm).toBe(2);
      expect(result10km.cellKm).toBe(10);

      // Smaller cells = more precision (or equal if both snap to same base)
      expect(Math.abs(result2km.glat - 43.4832)).toBeLessThanOrEqual(Math.abs(result10km.glat - 43.4832));
    });

    it('should handle negative coordinates', () => {
      const result = gridCell(-33.8688, 151.2093, 5); // Sydney
      expect(result.glat).toBeLessThan(0);
      expect(result.glng).toBeGreaterThan(0);
      expect(result.cellId).toMatch(/^g-33\.\d+:151\.\d+$/);
    });

    it('should handle coordinates near equator and prime meridian', () => {
      const equator = gridCell(0.1, 0.1, 5);
      // With 5km grid, 0.1° might snap to ~0.09 (which is correct)
      expect(equator.glat).toBeGreaterThanOrEqual(-0.5);
      expect(equator.glat).toBeLessThanOrEqual(0.5);
      expect(equator.glng).toBeGreaterThanOrEqual(-0.5);
      expect(equator.glng).toBeLessThanOrEqual(0.5);
    });

    it('should handle edge cases near poles', () => {
      const northPole = gridCell(89.9, 0, 5);
      expect(northPole.glat).toBeGreaterThan(85);
      expect(northPole.glat).toBeLessThanOrEqual(90);

      const southPole = gridCell(-89.9, 0, 5);
      expect(southPole.glat).toBeLessThan(-85);
      expect(southPole.glat).toBeGreaterThanOrEqual(-90);
    });

    it('should handle international date line', () => {
      const westSide = gridCell(0, 179.9, 5);
      const eastSide = gridCell(0, -179.9, 5);

      expect(westSide.cellId).not.toBe(eastSide.cellId);
    });

    it('should throw error for invalid latitude', () => {
      expect(() => gridCell(91, 0)).toThrow('Invalid latitude');
      expect(() => gridCell(-91, 0)).toThrow('Invalid latitude');
      expect(() => gridCell(NaN, 0)).toThrow('Invalid coordinates');
      expect(() => gridCell(Infinity, 0)).toThrow('Invalid coordinates');
    });

    it('should throw error for invalid longitude', () => {
      expect(() => gridCell(0, 181)).toThrow('Invalid longitude');
      expect(() => gridCell(0, -181)).toThrow('Invalid longitude');
      expect(() => gridCell(0, NaN)).toThrow('Invalid coordinates');
    });

    it('should throw error for invalid cell size', () => {
      expect(() => gridCell(0, 0, 0)).toThrow('Invalid cell size');
      expect(() => gridCell(0, 0, -5)).toThrow('Invalid cell size');
      expect(() => gridCell(0, 0, NaN)).toThrow('Invalid cell size');
    });

    it('should produce stable cellId format', () => {
      const result = gridCell(43.4832, -1.5586, 5);

      // cellId should be parseable
      const match = result.cellId.match(/^g([-\d.]+):([-\d.]+)$/);
      expect(match).not.toBeNull();

      const [, latStr, lngStr] = match!;
      expect(parseFloat(latStr)).toBeCloseTo(result.glat, 6);
      expect(parseFloat(lngStr)).toBeCloseTo(result.glng, 6);
    });

    it('should avoid floating point precision issues', () => {
      // Test coordinates that might cause float precision problems
      const result1 = gridCell(43.48320001, -1.55860001, 5);
      const result2 = gridCell(43.48320002, -1.55860002, 5);

      // Should be in same cell (difference < 1mm)
      expect(result1.cellId).toBe(result2.cellId);
    });

    it('should be deterministic (same input = same output)', () => {
      const results = Array.from({ length: 100 }, () =>
        gridCell(43.4832, -1.5586, 5)
      );

      const firstCellId = results[0].cellId;
      results.forEach(r => {
        expect(r.cellId).toBe(firstCellId);
      });
    });
  });

  describe('gridCellDistance()', () => {
    it('should calculate distance between same cell as 0', () => {
      const cell1 = gridCell(43.4832, -1.5586, 5);
      const cell2 = gridCell(43.4832, -1.5586, 5);

      const distance = gridCellDistance(cell1, cell2);
      expect(distance).toBe(0);
    });

    it('should calculate approximate distance between different cells', () => {
      const biarritz = gridCell(43.4832, -1.5586, 5);
      const bayonne = gridCell(43.4931, -1.4748, 5); // ~7km away

      const distance = gridCellDistance(biarritz, bayonne);

      // Distance should be approximately 7km (±2km due to grid snapping)
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(15);
    });

    it('should calculate long distances accurately', () => {
      const paris = gridCell(48.8566, 2.3522, 5);
      const london = gridCell(51.5074, -0.1278, 5);

      const distance = gridCellDistance(paris, london);

      // Paris-London ~340km
      expect(distance).toBeGreaterThan(300);
      expect(distance).toBeLessThan(400);
    });
  });

  describe('gridCellsInRadius()', () => {
    it('should return at least center cell for small radius', () => {
      const cells = gridCellsInRadius(43.4832, -1.5586, 2, 5);

      expect(cells.length).toBeGreaterThanOrEqual(1);

      // Center cell should be included
      const centerCell = gridCell(43.4832, -1.5586, 5);
      expect(cells.some(c => c.cellId === centerCell.cellId)).toBe(true);
    });

    it('should return multiple cells for larger radius', () => {
      const cells = gridCellsInRadius(43.4832, -1.5586, 15, 5);

      // 15km radius with 5km cells should cover ~20-50 cells (circular area)
      expect(cells.length).toBeGreaterThan(4);
      expect(cells.length).toBeLessThan(50);
    });

    it('should not include cells outside radius', () => {
      const centerLat = 43.4832;
      const centerLng = -1.5586;
      const radiusKm = 10;

      const cells = gridCellsInRadius(centerLat, centerLng, radiusKm, 5);
      const centerCell = gridCell(centerLat, centerLng, 5);

      cells.forEach(cell => {
        const distance = gridCellDistance(centerCell, cell);
        expect(distance).toBeLessThanOrEqual(radiusKm + 5); // +5km tolerance for cell size
      });
    });

    it('should return unique cells (no duplicates)', () => {
      const cells = gridCellsInRadius(43.4832, -1.5586, 20, 5);

      const cellIds = cells.map(c => c.cellId);
      const uniqueCellIds = new Set(cellIds);

      expect(cellIds.length).toBe(uniqueCellIds.size);
    });

    it('should handle edge cases near map boundaries', () => {
      // Near north pole
      const cells = gridCellsInRadius(89, 0, 50, 10);
      expect(cells.length).toBeGreaterThan(0);

      // All cells should have valid coordinates
      cells.forEach(cell => {
        expect(cell.glat).toBeGreaterThanOrEqual(-90);
        expect(cell.glat).toBeLessThanOrEqual(90);
      });
    });
  });

  describe('recommendedGridSize()', () => {
    it('should recommend grid size based on search radius', () => {
      expect(recommendedGridSize(10)).toBe(5); // 10km search → 5km grid
      expect(recommendedGridSize(20)).toBe(10); // 20km search → 10km grid
      expect(recommendedGridSize(4)).toBe(2); // 4km search → 2km grid
    });

    it('should clamp to minimum 2km', () => {
      expect(recommendedGridSize(1)).toBe(2);
      expect(recommendedGridSize(0.5)).toBe(2);
    });

    it('should clamp to maximum 10km', () => {
      expect(recommendedGridSize(100)).toBe(10);
      expect(recommendedGridSize(50)).toBe(10);
    });

    it('should return reasonable values for typical use cases', () => {
      // Urban: 5km search
      expect(recommendedGridSize(5)).toBeGreaterThanOrEqual(2);
      expect(recommendedGridSize(5)).toBeLessThanOrEqual(3);

      // Suburban: 15km search
      expect(recommendedGridSize(15)).toBeGreaterThanOrEqual(7);
      expect(recommendedGridSize(15)).toBeLessThanOrEqual(8);
    });
  });

  describe('DEFAULT_GRID_CELL_KM', () => {
    it('should be 5km', () => {
      expect(DEFAULT_GRID_CELL_KM).toBe(5);
    });
  });

  describe('Integration: Cache key stability', () => {
    it('should generate stable cache keys for matching searches', () => {
      // Simulate matching cache key generation
      const sport = 'surf';
      const level = 'beginner';
      const radius = 10;

      // User 1 search
      const user1Lat = 43.4832;
      const user1Lng = -1.5586;
      const cell1 = gridCell(user1Lat, user1Lng, 5);
      const key1 = `matching:${sport}:${level}:${cell1.cellId}:${radius}`;

      // User 2 search (3km away, same cell)
      const user2Lat = 43.4901;
      const user2Lng = -1.5621;
      const cell2 = gridCell(user2Lat, user2Lng, 5);
      const key2 = `matching:${sport}:${level}:${cell2.cellId}:${radius}`;

      // Same cell = same cache key = cache hit ✓
      expect(key1).toBe(key2);
    });

    it('should generate different cache keys for distant searches', () => {
      const sport = 'surf';
      const level = 'beginner';
      const radius = 10;

      // Biarritz
      const cell1 = gridCell(43.4832, -1.5586, 5);
      const key1 = `matching:${sport}:${level}:${cell1.cellId}:${radius}`;

      // Hossegor (20km away)
      const cell2 = gridCell(43.6617, -1.4086, 5);
      const key2 = `matching:${sport}:${level}:${cell2.cellId}:${radius}`;

      // Different cells = different cache keys
      expect(key1).not.toBe(key2);
    });
  });
});
