"use client";

// Force SSR for admin auth and dynamic data
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { apiClient, type AdminEngagementAnalytics, type AdminMatchingAnalytics, type AdminAnalyticsPeriod, type AdminBehaviorAnalytics, type AdminMatchingTTFM } from '../../../lib/apiClient';
import { ArrowLeft, TrendingUp, Users, Heart, Target, MapPin, Clock, Activity, Navigation, LifeBuoy, MessageSquare, BarChart3, Hourglass, DollarSign, MousePointer } from 'lucide-react';
import Link from 'next/link';

const PERIODS: Array<{ value: AdminAnalyticsPeriod; label: string }> = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: '90d', label: '90 jours' },
  { value: '1y', label: '1 an' }
];

const SPORT_LABELS: Record<string, string> = {
  surf: 'Surf',
  kitesurf: 'Kitesurf',
  windsurf: 'Windsurf'
};

const LEVEL_LABELS: Record<string, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé'
};

// Type pour les analytics publicitaires
interface AdAnalytics {
  isEnabled: boolean;
  impressions: number;
  revenue: number;
  cpm: number;
  ctr: number;
  topPerformingPages: Array<{ page: string; impressions: number; revenue: number }>;
}

export default function AdminAnalytics() {
  const router = useRouter();
  const [engagementData, setEngagementData] = useState<AdminEngagementAnalytics | null>(null);
  const [matchingData, setMatchingData] = useState<AdminMatchingAnalytics | null>(null);
  const [behaviorData, setBehaviorData] = useState<AdminBehaviorAnalytics | null>(null);
  const [ttfmData, setTtfmData] = useState<AdminMatchingTTFM | null>(null);
  const [adData, setAdData] = useState<AdAnalytics | null>(null);
  const [period, setPeriod] = useState<AdminAnalyticsPeriod>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

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

  const loadAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const [engagement, matching, behavior, ttfm] = await Promise.all([
        apiClient.getEngagementAnalytics(period),
        apiClient.getMatchingAnalytics(period),
        apiClient.getBehaviorAnalytics(period),
        apiClient.getMatchingTTFMAnalytics(period)
      ]);

      setEngagementData(engagement);
      setMatchingData(matching);
      setBehaviorData(behavior);
      setTtfmData(ttfm);

      // Analytics publicitaires (mock pour maintenant)
      const adsenseEnabled = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true';
      setAdData({
        isEnabled: adsenseEnabled,
        impressions: adsenseEnabled ? Math.floor(Math.random() * 5000 + 1000) : 0,
        revenue: adsenseEnabled ? parseFloat((Math.random() * 50 + 10).toFixed(2)) : 0,
        cpm: adsenseEnabled ? parseFloat((Math.random() * 8 + 2).toFixed(2)) : 0,
        ctr: adsenseEnabled ? parseFloat((Math.random() * 3 + 1).toFixed(2)) : 0,
        topPerformingPages: adsenseEnabled ? [
          { page: '/matching', impressions: 1200, revenue: 8.5 },
          { page: '/matching/cards', impressions: 800, revenue: 5.2 },
          { page: '/dashboard', impressions: 400, revenue: 2.1 }
        ] : []
      });
    } catch (err: any) {
      setError(err.message || 'Erreur de chargement des analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [period]);

  const formatPercent = (value: number) => `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`;
  const formatNumber = (value: number) => value.toLocaleString('fr-FR');
  const formatDecimal = (value: number, digits = 1) =>
    Number.isFinite(value) ? value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '0,0';
  const formatShare = (value: number, total: number) => formatPercent(total > 0 ? (value / total) * 100 : 0);
  const formatDuration = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
    const minutes = seconds / 60;
    if (minutes >= 180) {
      const hours = minutes / 60;
      return `${hours.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`;
    }
    return `${minutes.toLocaleString('fr-FR', { maximumFractionDigits: minutes >= 20 ? 0 : 1 })} min`;
  };
  const formatDaysValue = (value: number) => `${value.toLocaleString('fr-FR', { maximumFractionDigits: value >= 10 ? 0 : 1 })} j`;

  const sportPreferencesTotal = matchingData?.sportPreferences.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const levelPreferencesTotal = matchingData?.levelPreferences.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const searchesBySportTotal = matchingData?.searchesBySport.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const totalDecisions = matchingData?.overview.totalDecisions ?? 0;
  const acceptedDecisionRate = totalDecisions > 0 ? (matchingData?.overview.acceptedCount ?? 0) / totalDecisions * 100 : 0;
  const refusedDecisionRate = totalDecisions > 0 ? (matchingData?.overview.refusedCount ?? 0) / totalDecisions * 100 : 0;
  const riderBase = behaviorData?.userJourney.totals.riders ?? 0;
  const proBase = behaviorData?.userJourney.totals.pros ?? 0;
  const totalUsersCount = behaviorData?.userJourney.totals.users ?? 0;
  const currentPeriodLabel = PERIODS.find(p => p.value === period)?.label ?? '30 jours';
  const granularityLabel = {
    day: 'jour',
    week: 'semaine',
    month: 'mois'
  } as const;
  const matchingGranularity = matchingData?.periodGranularity ?? 'day';
  const ttfmGranularity = ttfmData?.periodGranularity ?? 'day';
  const ttfmCoverage = ttfmData && ttfmData.newRidersInPeriod > 0
    ? (ttfmData.sampleSize / ttfmData.newRidersInPeriod) * 100
    : 0;

  const formatTimelinePeriod = (iso: string, granularity: 'day' | 'week' | 'month') => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;

    if (granularity === 'month') {
      return date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
    }

    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <p>Chargement des analytics...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Analytics Détaillées</h1>
            <p className="text-muted-foreground">
              Métriques d'engagement et de matching
            </p>
          </div>
        </div>

        {/* Sélecteur de période */}
        <div className="flex gap-2">
          {PERIODS.map(p => (
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

      {/* Erreurs */}
      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Métriques d'engagement */}
      {engagementData && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Vue d'ensemble - Engagement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {formatNumber(engagementData.overview.totalUsers)}
                  </div>
                  <div className="text-sm text-muted-foreground">Utilisateurs total</div>
                </div>

                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {formatNumber(engagementData.overview.activeUsersLast7Days)}
                  </div>
                  <div className="text-sm text-muted-foreground">Actifs (7j)</div>
                </div>

                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {formatNumber(engagementData.overview.newUsersInPeriod)}
                  </div>
                  <div className="text-sm text-muted-foreground">Nouveaux ({PERIODS.find(p => p.value === period)?.label})</div>
                </div>

                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {formatNumber(engagementData.overview.totalRiders)} / {formatNumber(engagementData.overview.totalPros)}
                  </div>
                  <div className="text-sm text-muted-foreground">Riders / Pros</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Taux de rétention
              </CardTitle>
              <CardDescription>Pourcentage d'utilisateurs qui reviennent</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-500">
                    {formatPercent(engagementData.overview.retentionRates.day1)}
                  </div>
                  <div className="text-sm text-muted-foreground">Rétention J+1</div>
                </div>

                <div className="text-center">
                  <div className="text-3xl font-bold text-yellow-500">
                    {formatPercent(engagementData.overview.retentionRates.day7)}
                  </div>
                  <div className="text-sm text-muted-foreground">Rétention J+7</div>
                </div>

                <div className="text-center">
                  <div className="text-3xl font-bold text-red-500">
                    {formatPercent(engagementData.overview.retentionRates.day30)}
                  </div>
                  <div className="text-sm text-muted-foreground">Rétention J+30</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Métriques de matching */}
      {matchingData && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Heart className="h-5 w-5" />
                Vue d'ensemble - Matching
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {formatNumber(matchingData.overview.totalDecisions)}
                  </div>
                  <div className="text-sm text-muted-foreground">Décisions totales</div>
                </div>

                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-600">
                    {formatNumber(matchingData.overview.acceptedCount)}
                  </div>
                  <div className="text-sm text-muted-foreground">Acceptées</div>
                </div>

                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {formatNumber(matchingData.overview.refusedCount)}
                  </div>
                  <div className="text-sm text-muted-foreground">Refusées</div>
                </div>

                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {formatPercent(matchingData.overview.acceptRate)}
                  </div>
                  <div className="text-sm text-muted-foreground">Taux d'acceptation</div>
                </div>

                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {formatPercent(matchingData.overview.matchRate)}
                  </div>
                  <div className="text-sm text-muted-foreground">Taux de match</div>
                </div>

                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {formatNumber(matchingData.overview.matchedConversations)}
                  </div>
                  <div className="text-sm text-muted-foreground">Conversations créées</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Taux de match = conversations créées ÷ décisions totales · Usage géolocalisation : {formatPercent(matchingData.overview.geoUsageRate)} des recherches
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Décisions sur la période
                </CardTitle>
                <CardDescription>
                  Acceptations et refus agrégés par {granularityLabel[matchingGranularity]}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {matchingData.decisionTimeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Pas de décisions enregistrées sur cette période.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-2 pr-4">Période</th>
                          <th className="py-2 pr-4">Acceptées</th>
                          <th className="py-2 pr-4">Refusées</th>
                          <th className="py-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchingData.decisionTimeline.map(item => (
                          <tr key={item.period} className="border-t border-muted">
                            <td className="py-2 pr-4">{formatTimelinePeriod(item.period, matchingGranularity)}</td>
                            <td className="py-2 pr-4 text-emerald-600 font-medium">{formatNumber(item.accepted)}</td>
                            <td className="py-2 pr-4 text-red-500 font-medium">{formatNumber(item.refused)}</td>
                            <td className="py-2">{formatNumber(item.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Heart className="h-5 w-5" />
                  Conversations créées
                </CardTitle>
                <CardDescription>
                  Volume de conversations par {granularityLabel[matchingGranularity]}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {matchingData.conversationTimeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune conversation ouverte sur cette période.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-2 pr-4">Période</th>
                          <th className="py-2">Conversations</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchingData.conversationTimeline.map(item => (
                          <tr key={item.period} className="border-t border-muted">
                            <td className="py-2 pr-4">{formatTimelinePeriod(item.period, matchingGranularity)}</td>
                            <td className="py-2">{formatNumber(item.conversations)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {ttfmData && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Hourglass className="h-5 w-5" />
                    Time to First Match
                  </CardTitle>
                  <CardDescription>
                    Médiane et distribution du temps avant premier match sur {granularityLabel[ttfmGranularity]}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {ttfmData.sampleSize === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucun premier match enregistré sur cette période.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{formatDaysValue(ttfmData.medianDays)}</div>
                        <div className="text-sm text-muted-foreground">Médiane</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-emerald-600">{formatDaysValue(ttfmData.averageDays)}</div>
                        <div className="text-sm text-muted-foreground">Moyenne</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{formatDaysValue(ttfmData.p90Days)}</div>
                        <div className="text-sm text-muted-foreground">P90</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">{formatPercent(ttfmCoverage)}</div>
                        <div className="text-sm text-muted-foreground">Riders matchés ({ttfmData.sampleSize}/{ttfmData.newRidersInPeriod})</div>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {ttfmData.ridersWithoutMatch > 0
                      ? `${formatNumber(ttfmData.ridersWithoutMatch)} nouveaux riders n'ont pas encore matché sur la période.`
                      : 'Tous les nouveaux riders de la période ont un premier match.'}
                  </p>
                </CardContent>
              </Card>

              {ttfmData.sampleSize > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        Répartition des délais
                      </CardTitle>
                      <CardDescription>
                        Temps avant premier match par tranche (jours)
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="text-xs uppercase text-muted-foreground">
                            <tr className="text-left">
                              <th className="py-2 pr-4">Tranche</th>
                              <th className="py-2">Riders</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ttfmData.buckets.map(bucket => (
                              <tr key={bucket.label} className="border-t border-muted">
                                <td className="py-2 pr-4">{bucket.label} jours</td>
                                <td className="py-2">{formatNumber(bucket.count)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Évolution du TTFM
                      </CardTitle>
                      <CardDescription>
                        Moyenne par {granularityLabel[ttfmGranularity]}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {ttfmData.timeline.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Aucune donnée suffisante pour tracer la tendance.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead className="text-xs uppercase text-muted-foreground">
                              <tr className="text-left">
                                <th className="py-2 pr-4">Période</th>
                                <th className="py-2 pr-4">TTFM moyen</th>
                                <th className="py-2">Matches</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ttfmData.timeline.map(item => (
                                <tr key={item.period} className="border-t border-muted">
                                  <td className="py-2 pr-4">{formatTimelinePeriod(item.period, ttfmGranularity)}</td>
                                  <td className="py-2 pr-4">{formatDaysValue(item.averageDays)}</td>
                                  <td className="py-2">{formatNumber(item.count)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Préférences de sport */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Sports populaires
                </CardTitle>
                <CardDescription>Répartition des sports pratiqués</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {matchingData.sportPreferences.map((sport, index) => {
                    const count = sport.count;
                    const percentage = sportPreferencesTotal > 0 ? (count / sportPreferencesTotal) * 100 : 0;

                    return (
                      <div key={sport.sport} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${index === 0 ? 'bg-blue-500' : index === 1 ? 'bg-green-500' : 'bg-orange-500'}`}></div>
                          <span className="font-medium">
                            {SPORT_LABELS[sport.sport] || sport.sport}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{formatPercent(percentage)}</Badge>
                          <span className="text-sm text-muted-foreground">({formatNumber(count)})</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Préférences de niveau */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Niveaux populaires
                </CardTitle>
                <CardDescription>Répartition des niveaux</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {matchingData.levelPreferences.map((level, index) => {
                    const count = level.count;
                    const percentage = levelPreferencesTotal > 0 ? (count / levelPreferencesTotal) * 100 : 0;

                    return (
                      <div key={level.level} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${index === 0 ? 'bg-green-500' : index === 1 ? 'bg-yellow-500' : 'bg-red-500'}`}></div>
                          <span className="font-medium">
                            {LEVEL_LABELS[level.level] || level.level}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{formatPercent(percentage)}</Badge>
                          <span className="text-sm text-muted-foreground">({formatNumber(count)})</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Détails des décisions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Détail des décisions de matching
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-3xl font-bold text-green-500">
                    {formatNumber(matchingData.overview.acceptedCount)}
                  </div>
                  <div className="text-sm text-muted-foreground">Acceptées</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatPercent(acceptedDecisionRate)}
                  </div>
                </div>

                <div className="text-center p-4 border rounded-lg">
                  <div className="text-3xl font-bold text-red-500">
                    {formatNumber(matchingData.overview.refusedCount)}
                  </div>
                  <div className="text-sm text-muted-foreground">Refusées</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatPercent(refusedDecisionRate)}
                  </div>
                </div>

                <div className="text-center p-4 border rounded-lg">
                  <div className="text-3xl font-bold text-blue-500">
                    {formatNumber(matchingData.overview.totalDecisions)}
                  </div>
                  <div className="text-sm text-muted-foreground">Total</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Sur {PERIODS.find(p => p.value === period)?.label}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Analytics publicitaires */}
      {adData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Monétisation Publicitaire
              {adData.isEnabled ? (
                <Badge variant="default" className="bg-green-500">Actif</Badge>
              ) : (
                <Badge variant="secondary">Désactivé</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Revenus AdSense sur {currentPeriodLabel}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!adData.isEnabled ? (
              <div className="text-center py-6 space-y-3">
                <div className="text-4xl">💰</div>
                <h3 className="font-semibold">AdSense non configuré</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Activez AdSense pour commencer à générer des revenus publicitaires.
                  Voir le guide <code>ADSENSE_DEPLOYMENT.md</code> pour la configuration.
                </p>
                <Button variant="outline" size="sm" asChild>
                  <a href="https://www.google.com/adsense/" target="_blank" rel="noopener noreferrer">
                    Créer compte AdSense
                  </a>
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {formatDecimal(adData.revenue, 2)}€
                    </div>
                    <div className="text-sm text-muted-foreground">Revenus totaux</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {formatNumber(adData.impressions)}
                    </div>
                    <div className="text-sm text-muted-foreground">Impressions</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {formatDecimal(adData.cpm, 2)}€
                    </div>
                    <div className="text-sm text-muted-foreground">CPM moyen</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {formatDecimal(adData.ctr, 2)}%
                    </div>
                    <div className="text-sm text-muted-foreground">CTR moyen</div>
                  </div>
                </div>

                {adData.topPerformingPages.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <MousePointer className="h-4 w-4" />
                      Pages les plus rentables
                    </h4>
                    <div className="space-y-2">
                      {adData.topPerformingPages.map((page, index) => (
                        <div key={page.page} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${index === 0 ? 'bg-green-500' : index === 1 ? 'bg-blue-500' : 'bg-orange-500'}`}></div>
                            <span className="font-medium">{page.page}</span>
                          </div>
                          <div className="flex items-center gap-4 text-muted-foreground">
                            <span>{formatNumber(page.impressions)} vues</span>
                            <span className="font-medium text-green-600">{formatDecimal(page.revenue, 2)}€</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      💡 Utilisez ces données pour négocier des partenariats directs avec les marques surf/kite
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recherches par sport */}
      {matchingData && matchingData.searchesBySport.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Recherches par sport
            </CardTitle>
            <CardDescription>Sports les plus recherchés</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {matchingData.searchesBySport.map((search, index) => {
                const count = search.count;
                const percentage = searchesBySportTotal > 0 ? (count / searchesBySportTotal) * 100 : 0;

                return (
                  <div key={search.sport} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${index === 0 ? 'bg-blue-500' : index === 1 ? 'bg-green-500' : 'bg-orange-500'}`}></div>
                      <span className="font-medium">
                        {SPORT_LABELS[search.sport] || search.sport}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{formatPercent(percentage)}</Badge>
                      <span className="text-sm text-muted-foreground">({formatNumber(count)} recherches)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {behaviorData && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Vue d'ensemble comportementale
              </CardTitle>
              <CardDescription>
                Indicateurs clés sur la période sélectionnée ({currentPeriodLabel})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">
                    {formatNumber(totalUsersCount)}
                  </div>
                  <p className="text-sm text-muted-foreground">Utilisateurs actifs</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {formatShare(behaviorData.userJourney.riders.onboardingComplete, riderBase)}
                  </div>
                  <p className="text-sm text-muted-foreground">Riders onboarding complet</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-600">
                    {formatShare(behaviorData.userJourney.pros.offersPublished, proBase)}
                  </div>
                  <p className="text-sm text-muted-foreground">Pros avec offre active</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-rose-600">
                    {formatNumber(behaviorData.support.totalReports)}
                  </div>
                  <p className="text-sm text-muted-foreground">Signalements sur {currentPeriodLabel}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Parcours riders
                </CardTitle>
                <CardDescription>Étapes clés et taux de complétion</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: 'Profil créé', value: behaviorData.userJourney.riders.profileCreated },
                  { label: 'Pseudo renseigné', value: behaviorData.userJourney.riders.displayName },
                  { label: 'Sport+niveau choisis', value: behaviorData.userJourney.riders.disciplines },
                  { label: 'Photo de profil', value: behaviorData.userJourney.riders.photo },
                  { label: 'Onboarding complet', value: behaviorData.userJourney.riders.onboardingComplete },
                  { label: 'Recherche configurée', value: behaviorData.userJourney.riders.searchConfigured }
                ].map(step => {
                  const percent = riderBase > 0 ? Math.min(100, Math.round((step.value / riderBase) * 100)) : 0;
                  return (
                    <div key={step.label} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>{step.label}</span>
                        <span className="text-muted-foreground">
                          {formatNumber(step.value)} ({formatShare(step.value, riderBase)})
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  );
                })}

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Nouveaux riders ({currentPeriodLabel})</p>
                    <p className="text-lg font-semibold">{formatNumber(behaviorData.userJourney.riders.recentNewUsers)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Riders actifs (match / message)</p>
                    <p className="text-lg font-semibold">{formatNumber(behaviorData.userJourney.riders.recentDecisions + behaviorData.userJourney.riders.recentMessagers)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Navigation className="h-5 w-5" />
                  Parcours pros
                </CardTitle>
                <CardDescription>Progression des profils professionnels</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: 'Profil pro créé', value: behaviorData.userJourney.pros.profileCreated },
                  { label: 'Offre publiée', value: behaviorData.userJourney.pros.offersPublished },
                  { label: 'Vérifié', value: behaviorData.userJourney.pros.verified }
                ].map(step => {
                  const percent = proBase > 0 ? Math.min(100, Math.round((step.value / proBase) * 100)) : 0;
                  return (
                    <div key={step.label} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>{step.label}</span>
                        <span className="text-muted-foreground">
                          {formatNumber(step.value)} ({formatShare(step.value, proBase)})
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  );
                })}

                <div className="grid grid-cols-3 gap-4 pt-2">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Nouveaux pros ({currentPeriodLabel})</p>
                    <p className="text-lg font-semibold">{formatNumber(behaviorData.userJourney.pros.recentNewUsers)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Profils créés</p>
                    <p className="text-lg font-semibold">{formatNumber(behaviorData.userJourney.pros.recentProfiles)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Offres publiées</p>
                    <p className="text-lg font-semibold">{formatNumber(behaviorData.userJourney.pros.recentOffers)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Sessions & engagement
                </CardTitle>
                <CardDescription>Analyse des sessions sur {currentPeriodLabel}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Sessions totales</p>
                    <p className="text-xl font-semibold">{formatNumber(behaviorData.sessions.totalSessions)}</p>
                    <p className="text-xs text-muted-foreground">{formatDecimal(behaviorData.sessions.avgSessionsPerUser)} sessions / utilisateur</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Utilisateurs actifs</p>
                    <p className="text-xl font-semibold">{formatNumber(behaviorData.sessions.uniqueUsers)}</p>
                    <p className="text-xs text-muted-foreground">{formatShare(behaviorData.sessions.uniqueUsers, totalUsersCount)} de la base</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Durée moyenne</p>
                    <p className="text-lg font-semibold">{formatDuration(behaviorData.sessions.avgDurationSeconds)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Durée médiane</p>
                    <p className="text-lg font-semibold">{formatDuration(behaviorData.sessions.medianDurationSeconds)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Session max</p>
                    <p className="text-lg font-semibold">{formatDuration(behaviorData.sessions.maxDurationSeconds)}</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground uppercase mb-2">Répartition sessions / utilisateur</p>
                  <div className="space-y-2">
                    {behaviorData.sessions.distribution.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Pas assez de données sur cette période.</p>
                    ) : (
                      behaviorData.sessions.distribution.map(item => (
                        <div key={item.sessions} className="flex justify-between text-sm">
                          <span>{item.sessions} session{item.sessions > 1 ? 's' : ''}</span>
                          <span className="text-muted-foreground">{formatNumber(item.users)} utilisateurs</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Usage des fonctionnalités
                </CardTitle>
                <CardDescription>Messagerie, recherche et géolocalisation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Messagerie</p>
                    <p className="text-lg font-semibold">{formatNumber(behaviorData.featureUsage.messaging.totalMessages)}</p>
                    <p className="text-xs text-muted-foreground">{formatNumber(behaviorData.featureUsage.messaging.uniqueSenders)} expéditeurs</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatDecimal(behaviorData.featureUsage.messaging.avgMessagesPerConversation)} msg/conversation</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Recherche</p>
                    <p className="text-lg font-semibold">{formatNumber(behaviorData.featureUsage.search.totalSearchUpdates)}</p>
                    <p className="text-xs text-muted-foreground">{formatDecimal(behaviorData.featureUsage.search.avgDistanceKm ?? 0)} km de rayon moyen</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatShare(behaviorData.featureUsage.search.geoSearches, behaviorData.featureUsage.search.totalSearchUpdates)} avec géoloc.</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground uppercase">Géolocalisation</p>
                    <p className="text-lg font-semibold">{formatNumber(behaviorData.featureUsage.geolocation.ridersWithLocation)}</p>
                    <p className="text-xs text-muted-foreground">Profils riders géolocalisés</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatShare(behaviorData.featureUsage.geolocation.searchesWithGeo, behaviorData.featureUsage.search.totalSearchUpdates)} des recherches</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LifeBuoy className="h-5 w-5" />
                Support & signalements
              </CardTitle>
              <CardDescription>Principaux motifs sur {currentPeriodLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              {behaviorData.support.totalReports === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun signalement enregistré sur cette période.</p>
              ) : (
                <div className="space-y-2">
                  {behaviorData.support.reportsByReason.map(reason => (
                    <div key={reason.reason} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span>{reason.reason}</span>
                      <span className="text-muted-foreground">{formatNumber(reason.count)} signalement{reason.count > 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
