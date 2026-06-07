import type { Level, Sport } from './matching';

export type UserRole = 'RIDER' | 'PRO' | 'ADMIN';

export interface DashboardUser {
  id: string;
  email: string;
  role: UserRole;
  emailVerified?: boolean;
}

export interface PublicUser extends DashboardUser {
  displayName?: string | null;
  photoUrl?: string | null;
}

export type Gender = 'FEMALE' | 'MALE' | 'OTHER' | 'UNSPECIFIED';

export interface UserProfile {
  id: string;
  userId: string;
  displayName?: string | null;
  bio?: string | null;
  sex?: Gender | null;
  maxDistanceKm?: number | null;
  emailNotif?: boolean;
  wantsLesson?: boolean;
  lessonSport?: Sport | null;
  lessonLevel?: Level | null;
  lessonDate?: string | null;
  lessonPlace?: string | null;
  lessonStudentCount?: number | null;
  lat?: number | null;
  lng?: number | null;
  hasPhoto?: boolean;
  photoEndpoint?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type UserProfileUpdate = {
  displayName?: string;
  bio?: string;
  sex?: Gender;
  maxDistanceKm?: number;
  emailNotif?: boolean;
  photoUrl?: null;
  lat?: number;
  lng?: number;
  wantsLesson?: boolean;
  lessonSport?: Sport | null;
  lessonLevel?: Level | null;
  lessonDate?: string | null;
  lessonPlace?: string | null;
  lessonStudentCount?: number | null;
  lessonLat?: number | null;
  lessonLng?: number | null;
};

export type DisciplinePreference = {
  sport: Sport;
  level: Level;
};
