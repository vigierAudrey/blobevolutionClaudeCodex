import type { Sport, Level } from './matching';

export interface OfferProSummary {
  id: string;
  userId: string;
  businessName?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  verified: boolean;
}

export interface OfferCard {
  id: string;
  sport: Sport;
  level: Level;
  title: string;
  description: string;
  hourlyRate: number;
  lat: number;
  lng: number;
  createdAt: string;
  distanceKm: number;
  pro: OfferProSummary;
}

export interface OfferSearchParams {
  lat: number;
  lng: number;
  radiusKm: number;
  sport?: Sport;
  level?: Level;
}

export interface OfferSearchResponse {
  offers: OfferCard[];
  total: number;
  searchParams: OfferSearchParams;
}

export interface OfferFilters {
  sport: Sport | '';
  level: Level | '';
  radiusKm: number;
}

export interface OfferStats {
  uniqueClicks: number;
  lastClickAt: string | null;
}

export interface EditableOffer {
  id?: string;
  sport: Sport;
  level: Level;
  title: string;
  description: string;
  hourlyRate: number;
  isActive: boolean;
  lat?: number;
  lng?: number;
  stats?: OfferStats;
  createdAt?: string;
  updatedAt?: string;
}
