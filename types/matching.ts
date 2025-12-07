export type Sport = 'surf' | 'kitesurf';

export type Level = 'beginner' | 'intermediate' | 'advanced';

import type { Gender } from './user';

export type Partner = 'ALL' | 'WOMEN' | 'MEN';

export interface MatchingSearchParams {
  sport: Sport;
  level: Level;
  date: string;
  sortBy?: 'distance' | 'name';
  excludeIds?: string[];
  limit?: number;
  cursor?: string;
  distanceKm?: number;
  location?: { lat: number; lng: number };
  partner?: Partner;
  page?: number;
  pageSize?: number;
}

export interface MatchingCandidate {
  id: string;
  displayName?: string | null;
  photoUrl?: string | null;
  wantsLesson?: boolean;
  gender?: Gender | null;
  sport?: Sport | null;
  level?: Level | null;
  bio?: string | null;
  distanceKm?: number | null;
  [key: string]: unknown;
}

export interface MatchingSearchResponse {
  results?: MatchingCandidate[];
  nextCursor?: string | null;
  hasMore?: boolean;
}
