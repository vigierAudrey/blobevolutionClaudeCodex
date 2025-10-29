import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { BackBar } from '../../../components/BackBar';

export default function ProPromosPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/pro/dashboard" />
      <Card>
        <CardHeader>
          <CardTitle>Offres promotionnelles</CardTitle>
          <CardDescription>Opportunités de partenariats et de visibilité pour votre activité</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🚀</span>
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-2">Bientôt disponible</h3>
                <p className="text-sm text-blue-800 mb-3">
                  Cette section accueillera des opportunités de partenariats et de visibilité pour les professionnels de Blobinfini.
                </p>
                <p className="text-sm text-blue-800 mb-3">
                  Au fur et à mesure du développement de la plateforme, nous proposerons des offres de sponsoring,
                  de mise en avant premium, et d'autres opportunités pour développer votre activité.
                </p>
                <p className="text-sm text-blue-800">
                  Nous rechercherons également des promotions intéressantes pour vous sur le matériel et l'équipement professionnel
                  (planches, combinaisons, accessoires, etc.) pour vous aider à optimiser vos coûts.
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🤝</span>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-2">Vous êtes sponsor ou marque ?</h3>
                <p className="text-sm text-gray-700 mb-3">
                  Si vous êtes une marque d'équipement, un sponsor, ou un acteur souhaitant gagner en visibilité
                  auprès des professionnels de la glisse, cet espace pourra accueillir vos offres promotionnelles.
                </p>
                <p className="text-xs text-gray-600 italic">
                  Les détails du programme de partenariat seront communiqués prochainement.
                </p>
              </div>
            </div>
          </div>

          <div className="text-center pt-2">
            <p className="text-xs text-muted-foreground">
              Cette page sera mise à jour au fur et à mesure de l'évolution du projet
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
