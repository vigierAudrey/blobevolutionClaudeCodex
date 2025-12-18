import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { BackBar } from '../../../components/BackBar';

export default function ProPromosPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      <BackBar fallbackHref="/pro/dashboard" />

      {/* Header compact avec style océan */}
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-amber-100 to-orange-100 dark:from-amber-900/20 dark:to-orange-900/20 p-4 border-2 border-amber-200/50 dark:border-amber-800/50">
        <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
          </svg>
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">Offres Promotionnelles 🎁</h1>
          <p className="text-sm text-muted-foreground">Partenariats et visibilité pour ton activité</p>
        </div>
      </div>

      <Card className="border-2 rounded-[1.75rem]">
        <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30">
          <CardTitle className="text-foreground">Prochainement disponible</CardTitle>
          <CardDescription>Opportunités de partenariats et de visibilité pour votre activité</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="rounded-2xl border-2 border-blue-200 dark:border-blue-800/50 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🚀</span>
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">Bientôt disponible</h3>
                <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
                  Cette section accueillera des opportunités de partenariats et de visibilité pour les professionnels de BlobConnect.
                </p>
                <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
                  Au fur et à mesure du développement de la plateforme, nous proposerons des offres de sponsoring,
                  de mise en avant premium, et d&apos;autres opportunités pour développer votre activité.
                </p>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Nous rechercherons également des promotions intéressantes pour vous sur le matériel et l&apos;équipement professionnel
                  (planches, combinaisons, accessoires, etc.) pour vous aider à optimiser vos coûts.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-800/50 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🤝</span>
              <div className="flex-1">
                <h3 className="font-semibold text-emerald-900 dark:text-emerald-100 mb-2">Vous êtes sponsor ou marque ?</h3>
                <p className="text-sm text-emerald-800 dark:text-emerald-200 mb-3">
                  Si vous êtes une marque d&apos;équipement, un sponsor, ou un acteur souhaitant gagner en visibilité
                  auprès des professionnels de la glisse, cet espace pourra accueillir vos offres promotionnelles.
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 italic">
                  Les détails du programme de partenariat seront communiqués prochainement.
                </p>
              </div>
            </div>
          </div>

          <div className="text-center pt-2">
            <p className="text-xs text-muted-foreground">
              Cette page sera mise à jour au fur et à mesure de l&apos;évolution du projet
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
