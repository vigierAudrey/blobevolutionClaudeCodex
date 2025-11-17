import type { Sport, Level } from './matching';

export interface ProProfileData {
  businessName?: string | null;
  bio?: string | null;
  emailNotif?: boolean;
  photoUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number | null;
}

export interface LessonRequest {
  id: string;
  userId: string;
  displayName?: string | null;
  lat: number;
  lng: number;
  distanceKm?: number | null;
  lessonSport?: Sport | null;
  lessonLevel?: Level | null;
  lessonDate?: string | null;
  lessonPlace?: string | null;
  note?: string | null;
}

export interface LessonRequestResponse {
  items: LessonRequest[];
}
