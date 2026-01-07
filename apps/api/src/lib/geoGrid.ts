/**
 * Geographic Grid Utility for Cache Key Stabilization
 *
 * Purpose: Generate stable, consistent cache keys for geographic searches
 * by snapping coordinates to a fixed grid. This reduces cache key cardinality
 * and improves cache hit rates for nearby searches.
 *
 * Security: Prevents DoS via cache fragmentation by limiting unique keys.
 * Performance: Increases cache reuse for users in same geographic area.
 *
 * @module geoGrid
 */

/**
 * Default grid cell size in kilometers.
 * 5km provides good balance between:
 * - Cache hit rate (users within 5km share cache)
 * - Geographic precision (acceptable for sports matching)
 * - Key cardinality (limited number of unique cells globally)
 */
export const DEFAULT_GRID_CELL_KM = 5;

/**
 * Approximate kilometers per degree of latitude.
 * Used for grid cell size calculations.
 * Note: This is constant globally (latitude spacing is uniform).
 */
const KM_PER_DEGREE_LAT = 111.32;

/**
 * Geographic grid cell result.
 */
export interface GridCell {
  /**
   * Normalized grid latitude (southwest corner of cell).
   * Stable across all coordinates within the same cell.
   */
  glat: number;

  /**
   * Normalized grid longitude (southwest corner of cell).
   * Stable across all coordinates within the same cell.
   */
  glng: number;

  /**
   * Unique cell identifier string.
   * Format: "g{glat}:{glng}" (e.g., "g43.45:-1.56")
   * Guaranteed stable and collision-free globally.
   */
  cellId: string;

  /**
   * Cell size in kilometers used for this grid.
   */
  cellKm: number;
}

/**
 * Snap coordinates to a geographic grid cell.
 *
 * This function converts arbitrary lat/lng coordinates into normalized
 * grid cell coordinates. All points within the same cell will map to
 * identical grid coordinates, enabling effective cache key sharing.
 *
 * Algorithm:
 * 1. Convert cell size from km to degrees
 * 2. Divide coordinates by cell size in degrees
 * 3. Floor to get cell index
 * 4. Multiply back to get southwest corner coordinates
 *
 * Example:
 * ```typescript
 * // Two users 3km apart will get the same cell (5km grid)
 * const user1 = gridCell(43.4832, -1.5586, 5);
 * const user2 = gridCell(43.4901, -1.5621, 5);
 * // user1.cellId === user2.cellId → cache shared ✓
 * ```
 *
 * @param lat - Latitude in decimal degrees [-90, 90]
 * @param lng - Longitude in decimal degrees [-180, 180]
 * @param cellKm - Optional cell size in kilometers (default: 5km)
 * @returns Grid cell with normalized coordinates and stable ID
 *
 * @throws {Error} If lat/lng are invalid (out of bounds or NaN)
 */
export function gridCell(
  lat: number,
  lng: number,
  cellKm: number = DEFAULT_GRID_CELL_KM
): GridCell {
  // Input validation
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng} (must be finite numbers)`);
  }

  if (lat < -90 || lat > 90) {
    throw new Error(`Invalid latitude: ${lat} (must be between -90 and 90)`);
  }

  if (lng < -180 || lng > 180) {
    throw new Error(`Invalid longitude: ${lng} (must be between -180 and 180)`);
  }

  if (cellKm <= 0 || !Number.isFinite(cellKm)) {
    throw new Error(`Invalid cell size: ${cellKm} (must be positive finite number)`);
  }

  // Convert cell size from km to degrees
  const cellDegrees = cellKm / KM_PER_DEGREE_LAT;

  // Snap to grid (floor to get southwest corner of cell)
  const glat = Math.floor(lat / cellDegrees) * cellDegrees;
  const glng = Math.floor(lng / cellDegrees) * cellDegrees;

  // Round to avoid floating point precision issues
  // 6 decimal places = ~0.11m precision (sufficient for km-scale grid)
  const glatRounded = Math.round(glat * 1000000) / 1000000;
  const glngRounded = Math.round(glng * 1000000) / 1000000;

  // Generate stable cell ID
  const cellId = `g${glatRounded}:${glngRounded}`;

  return {
    glat: glatRounded,
    glng: glngRounded,
    cellId,
    cellKm
  };
}

/**
 * Calculate approximate distance in km between two grid cells.
 *
 * Uses Haversine formula for accurate distance calculation.
 * Useful for determining if two cells are within search radius.
 *
 * @param cell1 - First grid cell
 * @param cell2 - Second grid cell
 * @returns Distance in kilometers
 */
export function gridCellDistance(cell1: GridCell, cell2: GridCell): number {
  const R = 6371; // Earth radius in km

  const dLat = toRadians(cell2.glat - cell1.glat);
  const dLng = toRadians(cell2.glng - cell1.glng);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRadians(cell1.glat)) * Math.cos(toRadians(cell2.glat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Get all grid cells within a radius from a center point.
 *
 * Returns a set of cell IDs that cover the search area.
 * Useful for multi-cell cache queries or geographic searches.
 *
 * @param centerLat - Center latitude
 * @param centerLng - Center longitude
 * @param radiusKm - Search radius in kilometers
 * @param cellKm - Grid cell size (default: 5km)
 * @returns Array of grid cells covering the search area
 */
export function gridCellsInRadius(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
  cellKm: number = DEFAULT_GRID_CELL_KM
): GridCell[] {
  const centerCell = gridCell(centerLat, centerLng, cellKm);
  const cellMap = new Map<string, GridCell>();
  cellMap.set(centerCell.cellId, centerCell);

  // Calculate how many cells to check in each direction
  const cellsToCheck = Math.ceil(radiusKm / cellKm) + 1;
  const cellDegrees = cellKm / KM_PER_DEGREE_LAT;

  // Generate neighboring cells
  for (let latOffset = -cellsToCheck; latOffset <= cellsToCheck; latOffset++) {
    for (let lngOffset = -cellsToCheck; lngOffset <= cellsToCheck; lngOffset++) {
      if (latOffset === 0 && lngOffset === 0) continue; // Skip center (already added)

      const testLat = centerCell.glat + (latOffset * cellDegrees);
      const testLng = centerCell.glng + (lngOffset * cellDegrees);

      // Validate bounds
      if (testLat < -90 || testLat > 90 || testLng < -180 || testLng > 180) {
        continue;
      }

      try {
        const testCell = gridCell(testLat, testLng, cellKm);

        // Skip if already added (prevents duplicates from floating point issues)
        if (cellMap.has(testCell.cellId)) {
          continue;
        }

        // Only include cells within radius
        if (gridCellDistance(centerCell, testCell) <= radiusKm) {
          cellMap.set(testCell.cellId, testCell);
        }
      } catch {
        // Skip invalid cells
        continue;
      }
    }
  }

  return Array.from(cellMap.values());
}

/**
 * Helper: Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

/**
 * Get grid cell size recommendation based on search radius.
 *
 * Heuristic: Use grid cell = radius / 2 for optimal cache reuse.
 * Clamps between 2km (urban) and 10km (rural) for practical limits.
 *
 * @param searchRadiusKm - Typical search radius for the use case
 * @returns Recommended grid cell size in km
 */
export function recommendedGridSize(searchRadiusKm: number): number {
  const recommended = searchRadiusKm / 2;

  // Clamp between 2km and 10km
  if (recommended < 2) return 2;
  if (recommended > 10) return 10;

  return Math.round(recommended);
}
