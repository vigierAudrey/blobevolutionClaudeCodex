"use client";

/**
 * Utilitaires de stockage des critères de matching pour permettre un reset global.
 */
const MATCHING_KEYS = [
  'matching.sport',
  'matching.level',
  'matching.date',
  'matching.distanceKm',
  'matching.lat',
  'matching.lng',
  'matching.useGeoloc',
  'matching.wantsLesson',
  'matching.partner',
] as const;

export const clearMatchingStorage = () => {
  if (typeof window === 'undefined') return;
  try {
    MATCHING_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
};
