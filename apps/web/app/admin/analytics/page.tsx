"use client";

// Force SSR for admin auth and dynamic data
export const dynamic = 'force-dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  apiClient,
  type AdminEngagementAnalytics,
  type AdminMatchingAnalytics,
  type AdminAnalyticsPeriod,
  type AdminBehaviorAnalytics,
  type AdminMatchingTTFM,
  type AdminLessonRequestsAnalytics,
} from '../../../lib/apiClient';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  ArrowLeft,
  BarChart3,
  Clock,
  ShieldCheck,
  Target,
  Users,
  AlertTriangle,
  Globe,
  LineChart,
  BookOpen,
} from 'lucide-react';

const PERIODS: Array<{ value: AdminAnalyticsPeriod; label: string }> = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: '90d', label: '90 jours' },
  { value: '1y', label: '1 an' },
];

const formatNumber = (value: number | null | undefined) =>
  typeof value === 'number' ? value.toLocaleString('fr-FR') : 'Masqué';

const formatPercent = (value: number | null | undefined) =>
  typeof value === 'number' ? `${value.toFixed(1)}%` : 'Masqué';

const formatRatio = (value: number | null | undefined) =>
  typeof value === 'number' ? value.toFixed(2) : 'Masqué';

const formatMinutes = (value: number | null | undefined) => {
  if (typeof value !== 'number') return 'Masqué';
  if (value <= 0) return '0 min';
  if (value >= 180) {
    const hours = value / 60;
    return `${hours.toFixed(1)} h`;
  }
  return `${Math.round(value)} min`;
};

const formatHours = (value: number | null | undefined) => {
  if (typeof value !== 'number') return 'Masqué';
  if (value <= 0) return '0 h';
  if (value >= 48) {
    const days = value / 24;
    return `${days.toFixed(1)} j`;
  }
  return `${value.toFixed(1)} h`;
};

export default function AdminAnalytics() {
  const router = useRouter();
  const [engagementData, setEngagementData] = useState<AdminEngagementAnalytics | null>(null);
  const [matchingData, setMatchingData] = useState<AdminMatchingAnalytics | null>(null);
  const [behaviorData, setBehaviorData] = useState<AdminBehaviorAnalytics | null>(null);
  const [ttfmData, setTtfmData] = useState<AdminMatchingTTFM | null>(null);
  const [lessonData, setLessonData] = useState<AdminLessonRequestsAnalytics | null>(null);
  const [period, setPeriod] = useState<AdminAnalyticsPeriod>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // No local hint check — truth comes from the server session.
        const currentUser = await apiClient.me();
        if (currentUser.role !== 'ADMIN') {
          router.replace('/dashboard');
          return;
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        router.replace('/login');
      }
    };

    checkAuth();
  }, [router]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [engagement, matching, behavior, ttfm, lesson] = await Promise.all([
        apiClient.getEngagementAnalytics(period),
        apiClient.getMatchingAnalytics(period),
        apiClient.getBehaviorAnalytics(period),
        apiClient.getMatchingTTFMAnalytics(period),
        apiClient.getLessonRequestsAnalytics(period),
      ]);

      setEngagementData(engagement);
      setMatchingData(matching);
      setBehaviorData(behavior);
      setTtfmData(ttfm);
      setLessonData(lesson);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur de chargement des analytics');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const rgpdThreshold = engagementData?.privacyThreshold ?? matchingData?.privacyThreshold ?? 20;

  const stickiness = engagementData?.stickiness;
  const retention = engagementData?.retention;
  const tractionTotals = engagementData?.totals;

  const ttfvRiders = ttfmData?.riders;
  const ttfvPros = ttfmData?.pros;

  const marketplace = matchingData;
  const trustSafety = behaviorData?.trustSafety;
  const blobosphere = behaviorData?.blobosphere;

  const blobosphereItems = useMemo(() => blobosphere?.items ?? [], [blobosphere?.items]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <p>Chargement des analytics...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Preuves de valeur</h1>
            <p className="text-muted-foreground">Analytics RGPD-safe pour sponsors & partenaires</p>
          </div>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card className="border-amber-200 bg-amber-50/70">
        <CardHeader className="flex flex-row items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <CardTitle className="text-sm">RGPD</CardTitle>
          <Badge variant="outline" className="text-amber-700">Seuil n &gt;= {rgpdThreshold}</Badge>
        </CardHeader>
        <CardContent className="text-sm text-amber-800">
          Segments masqués si l&apos;échantillon est inférieur à {rgpdThreshold}.
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-blue-600" />
          <h2 className="text-2xl font-semibold">Traction Riders & Pros</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Utilisateurs actifs (MAU)</CardTitle>
              <CardDescription>Unique actifs sur la période</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {formatNumber(stickiness?.mau.total ?? null)}
              </div>
              <div className="text-xs text-muted-foreground">
                Riders: {formatNumber(stickiness?.mau.riders ?? null)} · Pros: {formatNumber(stickiness?.mau.pros ?? null)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Stickiness DAU/MAU</CardTitle>
              <CardDescription>Ratio moyen sur la période</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {formatPercent(stickiness?.stickiness.total ?? null)}
              </div>
              <div className="text-xs text-muted-foreground">
                Riders: {formatPercent(stickiness?.stickiness.riders ?? null)} · Pros: {formatPercent(stickiness?.stickiness.pros ?? null)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Nouveaux comptes</CardTitle>
              <CardDescription>Créés sur la période</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {formatNumber(tractionTotals?.newRiders ?? null)} riders
              </div>
              <div className="text-xs text-muted-foreground">{formatNumber(tractionTotals?.newPros ?? null)} pros</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LineChart className="h-4 w-4" />
              Rétention par cohorte (J+1/J+7/J+30)
            </CardTitle>
            <CardDescription>Basée sur les journées actives définies</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-semibold">Riders</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">J+1</p>
                    <p className="font-medium">{formatPercent(retention?.riders.day1.rate ?? null)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">J+7</p>
                    <p className="font-medium">{formatPercent(retention?.riders.day7.rate ?? null)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">J+30</p>
                    <p className="font-medium">{formatPercent(retention?.riders.day30.rate ?? null)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Cohorte: {formatNumber(retention?.riders.cohortSize ?? null)}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold">Pros</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">J+1</p>
                    <p className="font-medium">{formatPercent(retention?.pros.day1.rate ?? null)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">J+7</p>
                    <p className="font-medium">{formatPercent(retention?.pros.day7.rate ?? null)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">J+30</p>
                    <p className="font-medium">{formatPercent(retention?.pros.day30.rate ?? null)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Cohorte: {formatNumber(retention?.pros.cohortSize ?? null)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" />
              Time-to-first-value (TTFV)
            </CardTitle>
            <CardDescription>Délai médian avant action valeur</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-semibold">Riders</p>
                <p className="text-2xl font-semibold">{formatMinutes(ttfvRiders?.medianMinutes ?? null)}</p>
                <p className="text-xs text-muted-foreground">P90: {formatMinutes(ttfvRiders?.p90Minutes ?? null)}</p>
              </div>
              <div>
                <p className="text-sm font-semibold">Pros</p>
                <p className="text-2xl font-semibold">{formatMinutes(ttfvPros?.medianMinutes ?? null)}</p>
                <p className="text-xs text-muted-foreground">P90: {formatMinutes(ttfvPros?.p90Minutes ?? null)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-emerald-600" />
          <h2 className="text-2xl font-semibold">Marketplace Health</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Demandes vs offres</CardTitle>
              <CardDescription>Ratio global</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {formatRatio(
                  marketplace?.acceptance.totalRequests && marketplace.acceptance.totalRequests > 0
                    ? (marketplace.acceptance.totalRequests || 0) / (marketplace.acceptance.responseSampleSize || 1)
                    : null,
                )}
              </div>
              <p className="text-xs text-muted-foreground">Ratio indicatif (demandes / réponses)</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Taux d&apos;acceptation</CardTitle>
              <CardDescription>Bookings acceptés</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{formatPercent(marketplace?.acceptance.acceptanceRate ?? null)}</div>
              <p className="text-xs text-muted-foreground">Total: {formatNumber(marketplace?.acceptance.totalRequests ?? null)} demandes</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Délai de réponse médian</CardTitle>
              <CardDescription>Pros → Riders</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{formatHours(marketplace?.acceptance.medianResponseHours ?? null)}</div>
              <p className="text-xs text-muted-foreground">Sur {formatNumber(marketplace?.acceptance.responseSampleSize ?? null)} réponses</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />
              Supply vs Demand par sport & zone large
            </CardTitle>
            <CardDescription>Segments masqués si n &lt; {rgpdThreshold}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2">Sport</th>
                  <th>Zone</th>
                  <th>Demandes</th>
                  <th>Offres</th>
                  <th>Ratio</th>
                </tr>
              </thead>
              <tbody>
                {marketplace?.supplyDemand.map((segment) => (
                  <tr key={`${segment.sport}-${segment.zoneLarge}`} className="border-t">
                    <td className="py-2 font-medium">{segment.sport}</td>
                    <td>{segment.zoneLarge}</td>
                    <td>{formatNumber(segment.demandRequests)}</td>
                    <td>{formatNumber(segment.supplyAvailabilities)}</td>
                    <td>{formatRatio(segment.ratio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Acceptation par sport</CardTitle>
            <CardDescription>Masqué si n &lt; {rgpdThreshold}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2">Sport</th>
                  <th>Demandes</th>
                  <th>Taux d&apos;acceptation</th>
                  <th>Délai médian</th>
                </tr>
              </thead>
              <tbody>
                {marketplace?.acceptanceBySport.map((row) => (
                  <tr key={row.sport} className="border-t">
                    <td className="py-2 font-medium">{row.sport}</td>
                    <td>{formatNumber(row.totalRequests)}</td>
                    <td>{formatPercent(row.acceptanceRate)}</td>
                    <td>{formatHours(row.medianResponseHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-rose-600" />
          <h2 className="text-2xl font-semibold">Trust & Safety</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Pros vérifiés</CardTitle>
              <CardDescription>Part du réseau vérifié</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {formatPercent(trustSafety?.verifiedProsRate ?? null)}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatNumber(trustSafety?.verifiedProsCount ?? null)} / {formatNumber(trustSafety?.totalPros ?? null)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Signalements / 1k users</CardTitle>
              <CardDescription>Période sélectionnée</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{formatNumber(trustSafety?.reportsPer1kUsers ?? null)}</div>
              <p className="text-xs text-muted-foreground">Total: {formatNumber(trustSafety?.reportsTotal ?? null)} signalements</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Délai médian modération</CardTitle>
              <CardDescription>Signalement → action</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{formatHours(trustSafety?.moderationMedianHours ?? null)}</div>
              <p className="text-xs text-muted-foreground">{formatNumber(trustSafety?.moderationSampleSize ?? null)} actions</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-sky-600" />
          <h2 className="text-2xl font-semibold">Blobosphère (SEO / Content)</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Pageviews</CardTitle>
              <CardDescription>Articles publiés</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{formatNumber(blobosphere?.totals.pageviews ?? null)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Outbound clicks</CardTitle>
              <CardDescription>Promos / partenaires</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{formatNumber(blobosphere?.totals.outboundClicks ?? null)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Conversions inscription</CardTitle>
              <CardDescription>Consentement requis</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{formatNumber(blobosphere?.totals.signupConversions ?? null)}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Performance par article</CardTitle>
            <CardDescription>Masqué si n &lt; {rgpdThreshold}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2">Article</th>
                  <th>Lecture</th>
                  <th>Pageviews</th>
                  <th>Outbound</th>
                  <th>Signups</th>
                </tr>
              </thead>
              <tbody>
                {blobosphereItems.map((item) => (
                  <tr key={item.slug} className="border-t">
                    <td className="py-2">
                      <p className="font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.slug}</p>
                    </td>
                    <td>{item.readingTimeMinutes} min</td>
                    <td>{formatNumber(item.pageviews)}</td>
                    <td>{formatNumber(item.outboundClicks)}</td>
                    <td>{formatNumber(item.signupConversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monétisation pub</CardTitle>
            <CardDescription>AdSense non configuré</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Not configured · Inventaire interne: {formatNumber(blobosphere?.totals.pageviews ?? null)} pageviews / {formatNumber(blobosphere?.totals.outboundClicks ?? null)} outbound clicks.
          </CardContent>
        </Card>
      </section>

      {/* ── Demandes de cours (BloboMap) ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-teal-600" />
          <h2 className="text-2xl font-semibold">Demandes de cours</h2>
        </div>

        {/* KPI cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Demandes actives</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{formatNumber(lessonData?.snapshot.totalActive ?? null)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                dont {formatNumber(lessonData?.snapshot.newInPeriod ?? null)} dans la période
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Surf / Kitesurf</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {formatNumber(lessonData?.snapshot.bySport.surf ?? null)}
                <span className="text-base font-normal text-muted-foreground"> surf</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatNumber(lessonData?.snapshot.bySport.kitesurf ?? null)} kitesurf
                {(lessonData?.snapshot.bySport.other ?? 0) > 0 && ` · ${lessonData?.snapshot.bySport.other} autre`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Contacts pros (période)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{formatNumber(lessonData?.proContactStats.totalContacts ?? null)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {lessonData?.proContactStats.masked
                  ? 'Riders contactés : masqué'
                  : `${formatNumber(lessonData?.proContactStats.distinctRidersContacted ?? null)} riders contactés`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Taux de contact pro</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {lessonData?.proContactStats.masked
                  ? 'Masqué'
                  : formatPercent(lessonData?.proContactStats.contactRatePct ?? null)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Délai médian : {formatHours(lessonData?.proContactStats.medianFirstContactHours ?? null)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Répartition par nombre d'élèves */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Taille de groupe
              </CardTitle>
              <CardDescription>Nombre d&apos;élèves par demande</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2">Taille</th>
                    <th>Nb demandes</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Solo (1)', value: lessonData?.snapshot.byStudentCount.solo ?? 0 },
                    { label: 'Duo (2)', value: lessonData?.snapshot.byStudentCount.duo ?? 0 },
                    { label: 'Groupe (3+)', value: lessonData?.snapshot.byStudentCount.group ?? 0 },
                  ].map((row) => {
                    const total = lessonData?.snapshot.totalActive ?? 0;
                    const pct = total > 0 ? (row.value / total) * 100 : 0;
                    return (
                      <tr key={row.label} className="border-t">
                        <td className="py-2 font-medium">{row.label}</td>
                        <td>{formatNumber(row.value)}</td>
                        <td>{formatPercent(pct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Zones géographiques */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="h-4 w-4" />
                Zones géographiques
              </CardTitle>
              <CardDescription>Segments masqués si n &lt; {lessonData?.privacyThreshold ?? 20}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {(lessonData?.byZone.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune donnée géographique disponible.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-2">Zone</th>
                      <th>Nb demandes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(lessonData?.byZone ?? []).slice(0, 10).map((z) => (
                      <tr key={z.zone} className="border-t">
                        <td className="py-2 font-mono text-xs">{z.zone}</td>
                        <td>
                          {z.masked ? (
                            <span className="text-muted-foreground italic">masqué (n={z.sampleSize})</span>
                          ) : (
                            formatNumber(z.count)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
