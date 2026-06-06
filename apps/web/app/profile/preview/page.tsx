"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Spinner } from '../../../components/ui/spinner';
import { BackBar } from '../../../components/BackBar';
import { Eye } from 'lucide-react';
import { apiClient } from '../../../lib/apiClient';
import type { UserProfile, Gender } from '@/types/user';
import type { Level, Sport } from '@/types/matching';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobPageHeader } from '@/components/blob';

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
      <div className="mx-auto flex max-w-xl justify-center bg-blob-sand pt-12" aria-live="polite">
        <Spinner />
      </div>
    );
  }

  if (!profile) return null;

  const missingFields = getMissingFields(profile, disciplines);
  const genderLabel = profile.sex && profile.sex !== 'UNSPECIFIED' ? GENDER_LABELS[profile.sex] : null;

  return (
    <div className="mx-auto max-w-xl space-y-6 bg-blob-sand px-4 pb-16 pt-4 text-blob-black">
      <BackBar fallbackHref="/profile" />

      <BlobPageHeader
        title="Aperçu Profil"
        subtitle="Prévisualisation privée de ta fiche matching."
      />

      <BlobAlert
        variant="warning"
        title="Aperçu privé"
      >
        <div
        role="status"
        aria-label="Aperçu privé"
        data-testid="preview-banner"
      >
          <p className="flex items-center gap-2 text-sm font-medium">
            <Eye className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
            Aperçu privé — visible uniquement par vous
          </p>
          <p className="mt-1 text-xs">
            Voici comment les autres riders voient ton profil dans le matching.
          </p>
        </div>
      </BlobAlert>

      {missingFields.length > 0 && (
        <BlobAlert variant="warning" title="Profil incomplet">
          <div role="alert" data-testid="incomplete-warning" className="space-y-2">
            <p>Tu n&apos;apparaîtras pas dans le matching tant que ces éléments manquent.</p>
            <ul className="list-inside list-disc space-y-0.5 text-sm">
            {missingFields.map((f) => (
              <li key={f.key}>{f.label} manquant(e)</li>
            ))}
            </ul>
            <BlobButton asChild variant="outlineDark" size="sm" className="mt-2">
              <Link href="/profile">Compléter mon profil</Link>
            </BlobButton>
          </div>
        </BlobAlert>
      )}

      <BlobCard className="bg-white">
        <div className="space-y-5">
          <h2 className="text-xl font-black uppercase tracking-widest">Ton profil public</h2>
          <div className="rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-5 sm:p-6">
            <div className="mb-4 flex flex-col items-center gap-4">
              {profile.photoUrl ? (
                <Image
                  src={profile.photoUrl}
                  alt={profile.displayName ?? 'Photo de profil'}
                  width={256}
                  height={256}
                  className="h-64 w-64 rounded-sm border-4 border-white object-cover shadow-lg"
                  unoptimized
                  priority
                />
              ) : (
                <div className="flex h-64 w-64 items-center justify-center rounded-sm border-4 border-white bg-white text-6xl shadow-lg">
                  <span aria-hidden="true">👤</span>
                </div>
              )}

              <div className="w-full space-y-2 text-center">
                <div
                  data-testid="profile-display-name"
                  className="flex flex-wrap items-center justify-center gap-2 text-2xl font-black uppercase tracking-widest"
                >
                  {profile.displayName ?? (
                    <span className="text-lg italic normal-case tracking-normal text-blob-black/56">Nom non défini</span>
                  )}
                  {profile.wantsLesson && (
                    <BlobBadge variant="success">Cours</BlobBadge>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 text-base font-medium text-blob-black/64">
                  {genderLabel && <span>{genderLabel}</span>}
                  {disciplines.length > 0
                    ? disciplines.map((d) => (
                        <BlobBadge key={`${d.sport}-${d.level}`} variant="sand">
                          {SPORT_LABELS[d.sport]} · {LEVEL_LABELS[d.level]}
                        </BlobBadge>
                      ))
                    : (
                        <span className="text-sm italic text-blob-black/56">
                          Aucune discipline renseignée
                        </span>
                      )
                  }
                </div>
              </div>
            </div>

            {profile.bio && (
              <div className="mb-4 rounded-sm border-2 border-blob-sand-deep bg-white p-4 text-center text-base italic text-blob-black/72">
                &laquo;&nbsp;{profile.bio}&nbsp;&raquo;
              </div>
            )}

            {profile.wantsLesson &&
              (profile.lessonPlace || profile.lessonDate || profile.lessonStudentCount != null) && (
                <div className="space-y-1 rounded-sm border-2 border-green-800 bg-green-50 p-3 text-sm text-green-950">
                  <p className="font-black uppercase tracking-widest">Détails du cours souhaité</p>
                  {profile.lessonPlace && <p>Lieu : {profile.lessonPlace}</p>}
                  {profile.lessonDate && <p>Date : {formatDate(profile.lessonDate)}</p>}
                  {profile.lessonStudentCount != null && (
                    <p>Nombre d&apos;élèves : {profile.lessonStudentCount}</p>
                  )}
                </div>
              )}
          </div>
        </div>
      </BlobCard>

      <div className="flex justify-center">
        <BlobButton asChild variant="outlineDark" size="sm">
          <Link href="/profile">Modifier mon profil</Link>
        </BlobButton>
      </div>
    </div>
  );
}
