"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/spinner';
import { BackBar } from '../../../components/BackBar';
import { Eye } from 'lucide-react';
import { apiClient } from '../../../lib/apiClient';
import type { UserProfile, Gender } from '@/types/user';
import type { Level, Sport } from '@/types/matching';

type PublicRiderProfile = {
  displayName?: string | null;
  photoUrl?: string | null;
  bio?: string | null;
  sex?: Gender | null;
  wantsLesson?: boolean;
  lessonPlace?: string | null;
  lessonDate?: string | null;
  lessonStudentCount?: number | null;
};

type Discipline = { sport: Sport; level: Level };

const LEVEL_LABELS: Record<Level, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé',
  anytime: 'Peu importe',
};

const SPORT_LABELS: Record<Sport, string> = {
  surf: 'Surf',
  kitesurf: 'Kitesurf',
};

const GENDER_LABELS: Record<Gender, string> = {
  FEMALE: 'Femme',
  MALE: 'Homme',
  OTHER: 'Autre',
  UNSPECIFIED: 'Genre non précisé',
};

function toPublicProfile(raw: UserProfile): PublicRiderProfile {
  return {
    displayName: raw.displayName,
    photoUrl: raw.photoUrl,
    bio: raw.bio,
    sex: raw.sex,
    wantsLesson: raw.wantsLesson,
    lessonPlace: raw.lessonPlace,
    lessonDate: raw.lessonDate,
    lessonStudentCount: raw.lessonStudentCount,
  };
}

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

type MissingField = { key: string; label: string };

function getMissingFields(profile: PublicRiderProfile, disciplines: Discipline[]): MissingField[] {
  const missing: MissingField[] = [];
  if (!profile.displayName) missing.push({ key: 'displayName', label: 'Nom affiché' });
  if (!profile.photoUrl) missing.push({ key: 'photoUrl', label: 'Photo de profil' });
  if (disciplines.length === 0) missing.push({ key: 'disciplines', label: 'Discipline(s) pratiquée(s)' });
  return missing;
}

export default function ProfilePreviewPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<PublicRiderProfile | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [me, rawProfile, rawDisciplines] = await Promise.all([
          apiClient.me() as Promise<{ id: string; role: string }>,
          apiClient.getProfile() as Promise<UserProfile>,
          apiClient.getDisciplines(),
        ]);
        if (!mounted) return;
        if (me.role !== 'RIDER') {
          router.replace('/dashboard');
          return;
        }
        setProfile(toPublicProfile(rawProfile));
        setDisciplines(rawDisciplines as Discipline[]);
      } catch {
        if (mounted) router.replace('/login');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [router]);

  if (loading) {
    return (
      <div className="mx-auto max-w-xl pt-12 flex justify-center" aria-live="polite">
        <Spinner />
      </div>
    );
  }

  if (!profile) return null;

  const missingFields = getMissingFields(profile, disciplines);
  const genderLabel = profile.sex && profile.sex !== 'UNSPECIFIED' ? GENDER_LABELS[profile.sex] : null;

  return (
    <div className="mx-auto max-w-xl space-y-6 pb-16 px-4">
      <BackBar fallbackHref="/profile" />

      <div
        role="status"
        aria-label="Aperçu privé"
        data-testid="preview-banner"
        className="flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-4 py-3"
      >
        <Eye className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Aperçu privé — visible uniquement par vous
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Voici comment les autres riders voient ton profil dans le matching.
          </p>
        </div>
      </div>

      {missingFields.length > 0 && (
        <div
          role="alert"
          data-testid="incomplete-warning"
          className="rounded-xl border-2 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30 px-4 py-3 space-y-2"
        >
          <p className="text-sm font-semibold text-orange-800 dark:text-orange-300">
            Profil incomplet — tu n&apos;apparaîtras pas dans le matching
          </p>
          <ul className="text-sm text-orange-700 dark:text-orange-400 list-disc list-inside space-y-0.5">
            {missingFields.map((f) => (
              <li key={f.key}>{f.label} manquant(e)</li>
            ))}
          </ul>
          <Link
            href="/profile"
            className="inline-block text-xs text-orange-700 dark:text-orange-400 underline underline-offset-2 mt-1"
          >
            Compléter mon profil
          </Link>
        </div>
      )}

      <Card className="border-2 shadow-xl rounded-[2rem]">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Ton profil public</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-[1.75rem] border-2 p-5 sm:p-6 bg-gradient-to-br from-white via-white to-purple-50/50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800">
            <div className="flex flex-col items-center gap-4 mb-4">
              {profile.photoUrl ? (
                <Image
                  src={profile.photoUrl}
                  alt={profile.displayName ?? 'Photo de profil'}
                  width={256}
                  height={256}
                  className="w-64 h-64 rounded-[2rem] object-cover border-4 border-border shadow-2xl"
                  unoptimized
                  priority
                />
              ) : (
                <div className="w-64 h-64 rounded-[2rem] bg-muted flex items-center justify-center border-4 border-border shadow-2xl text-6xl">
                  <span aria-hidden="true">👤</span>
                </div>
              )}

              <div className="w-full text-center space-y-2">
                <div
                  data-testid="profile-display-name"
                  className="text-2xl font-bold text-foreground flex items-center justify-center gap-2 flex-wrap"
                >
                  {profile.displayName ?? (
                    <span className="text-muted-foreground italic text-lg">Nom non défini</span>
                  )}
                  {profile.wantsLesson && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-3 py-1 text-xs font-medium">
                      Cours
                    </span>
                  )}
                </div>

                <div className="text-base text-muted-foreground font-medium flex flex-wrap items-center justify-center gap-2">
                  {genderLabel && <span>{genderLabel}</span>}
                  {disciplines.length > 0
                    ? disciplines.map((d) => (
                        <Badge key={`${d.sport}-${d.level}`} variant="secondary" className="text-xs">
                          {SPORT_LABELS[d.sport]} · {LEVEL_LABELS[d.level]}
                        </Badge>
                      ))
                    : (
                        <span className="text-muted-foreground italic text-sm">
                          Aucune discipline renseignée
                        </span>
                      )
                  }
                </div>
              </div>
            </div>

            {profile.bio && (
              <div className="text-base text-muted-foreground italic bg-white/80 dark:bg-slate-700/50 border border-muted/40 dark:border-slate-600 p-4 rounded-2xl mb-4 text-center">
                &laquo;&nbsp;{profile.bio}&nbsp;&raquo;
              </div>
            )}

            {profile.wantsLesson &&
              (profile.lessonPlace || profile.lessonDate || profile.lessonStudentCount != null) && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/20 p-3 space-y-1 text-sm text-emerald-800 dark:text-emerald-300">
                  <p className="font-semibold">Détails du cours souhaité</p>
                  {profile.lessonPlace && <p>Lieu : {profile.lessonPlace}</p>}
                  {profile.lessonDate && <p>Date : {formatDate(profile.lessonDate)}</p>}
                  {profile.lessonStudentCount != null && (
                    <p>Nombre d&apos;élèves : {profile.lessonStudentCount}</p>
                  )}
                </div>
              )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button asChild variant="outline" size="sm">
          <Link href="/profile">Modifier mon profil</Link>
        </Button>
      </div>
    </div>
  );
}
