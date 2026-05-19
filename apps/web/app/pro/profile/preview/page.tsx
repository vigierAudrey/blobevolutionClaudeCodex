"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Spinner } from '../../../../components/ui/spinner';
import { BackBar } from '../../../../components/BackBar';
import { Eye } from 'lucide-react';
import { apiClient } from '../../../../lib/apiClient';

// Fields visible to riders — lat/lng/emailNotif/id/userId/createdAt/updatedAt/notificationPreferences excluded
type PublicProProfile = {
  businessName?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  radiusKm?: number | null;
  countryCode?: string | null;
  hasLocation: boolean;
};

// Shape of the raw /pro/me response — includes private fields that must never reach the DOM
type ProRawData = {
  businessName?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number | null;
  countryCode?: string | null;
};

function toPublicProProfile(raw: ProRawData): PublicProProfile {
  return {
    businessName: raw.businessName,
    bio: raw.bio,
    photoUrl: raw.photoUrl,
    radiusKm: raw.radiusKm,
    countryCode: raw.countryCode,
    // lat/lng converted to boolean — exact coordinates never exposed in the view
    hasLocation: raw.lat != null && raw.lng != null,
  };
}

type MissingField = { key: string; label: string };

function getMissingFields(profile: PublicProProfile): MissingField[] {
  const missing: MissingField[] = [];
  if (!profile.businessName) missing.push({ key: 'businessName', label: 'Nom commercial' });
  if (!profile.photoUrl) missing.push({ key: 'photoUrl', label: 'Photo ou logo' });
  return missing;
}

export default function ProProfilePreviewPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<PublicProProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const me = await (apiClient.me() as Promise<{ id: string; role: string }>);
        if (!mounted) return;
        if (me.role !== 'PRO') {
          router.replace('/dashboard');
          return;
        }
        // Only reached when role === 'PRO' — server enforces this via requireProRole on /pro/me
        const raw = await (apiClient.getProProfile() as Promise<ProRawData>);
        if (!mounted) return;
        setProfile(toPublicProProfile(raw));
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

  const missingFields = getMissingFields(profile);

  return (
    <div className="mx-auto max-w-xl space-y-6 pb-16 px-4">
      <BackBar fallbackHref="/pro/profile" />

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
            Voici comment les riders voient ton profil sur la BloboMap.
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
            Profil incomplet — tu n&apos;apparaîtras pas dans les résultats
          </p>
          <ul className="text-sm text-orange-700 dark:text-orange-400 list-disc list-inside space-y-0.5">
            {missingFields.map((f) => (
              <li key={f.key}>{f.label} manquant(e)</li>
            ))}
          </ul>
          <Link
            href="/pro/profile"
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
          <div className="rounded-[1.75rem] border-2 p-5 sm:p-6 bg-gradient-to-br from-white via-white to-amber-50/50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800">
            <div className="flex flex-col items-center gap-4 mb-4">
              {profile.photoUrl ? (
                <Image
                  src={profile.photoUrl}
                  alt={profile.businessName ?? 'Photo professionnelle'}
                  width={256}
                  height={256}
                  className="w-64 h-64 rounded-[2rem] object-cover border-4 border-border shadow-2xl"
                  unoptimized
                  priority
                />
              ) : (
                <div className="w-64 h-64 rounded-[2rem] bg-muted flex items-center justify-center border-4 border-border shadow-2xl text-6xl">
                  <span aria-hidden="true">🏄</span>
                </div>
              )}

              <div className="w-full text-center space-y-2">
                <div
                  data-testid="profile-business-name"
                  className="text-2xl font-bold text-foreground"
                >
                  {profile.businessName ?? (
                    <span className="text-muted-foreground italic text-lg">Nom commercial non défini</span>
                  )}
                </div>
                {profile.countryCode && (
                  <p className="text-sm text-muted-foreground">{profile.countryCode}</p>
                )}
              </div>
            </div>

            {profile.bio && (
              <div className="text-base text-muted-foreground italic bg-white/80 dark:bg-slate-700/50 border border-muted/40 dark:border-slate-600 p-4 rounded-2xl mb-4 text-center">
                &laquo;&nbsp;{profile.bio}&nbsp;&raquo;
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/30 p-3 text-sm text-slate-700 dark:text-slate-300">
              {profile.hasLocation ? (
                <p data-testid="location-active">
                  📍 Position active — visible sur la BloboMap
                  {profile.radiusKm != null && (
                    <span className="ml-1 text-muted-foreground">(rayon {profile.radiusKm} km)</span>
                  )}
                </p>
              ) : (
                <p data-testid="location-inactive" className="text-muted-foreground">
                  📍 Aucune position enregistrée
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button asChild variant="outline" size="sm">
          <Link href="/pro/profile">Modifier mon profil</Link>
        </Button>
      </div>
    </div>
  );
}
