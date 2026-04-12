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
  // Coordonnées arrondies à ~1 km — source de vérité pour le pin BloboMap.
  // Absentes si le rider n'a pas fourni de localisation de cours.
  lessonLatApprox?: number | null;
  lessonLngApprox?: number | null;
  distanceBucket?: '<5km' | '5-15km' | '15-30km' | '>30km' | null;
  lessonSport?: Sport | null;
  lessonLevel?: Level | null;
  lessonDate?: string | null;
  lessonPlace?: string | null;
  lessonStudentCount?: number | null;
}

export interface LessonRequestResponse {
  items: LessonRequest[];
}
