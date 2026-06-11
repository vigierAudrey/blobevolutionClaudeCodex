import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { BackBar } from '../../components/BackBar';
import { Badge } from '../../components/ui/badge';
import { Sparkles, Tag } from 'lucide-react';

// Placeholder non MVP : ne pas indexer tant que la fonctionnalité n'existe pas.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PromosPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-10">
      <BackBar fallbackHref="/dashboard" />

      {/* Page Header */}
      <div className="flex items-center gap-3 pb-2 border-b">
        <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900/30">
          <Tag className="w-5 h-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">Offres promotionnelles</h1>
            <Badge variant="secondary" className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
              <Sparkles className="w-3 h-3 mr-1" />
              Partenariats
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">Deals exclusifs avec écoles, loueurs et acteurs de la glisse</p>
        </div>
      </div>

      <Card className="border-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-white text-slate-700">
              Aperçu
            </Badge>
            <CardTitle>Espace partenariats</CardTitle>
          </div>
          <CardDescription>Espace dédié aux promotions et aux collabs avec des pros.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🚀</span>
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-2">Bientôt disponible</h3>
                <p className="text-sm text-blue-800 mb-3">
                  Cette section accueillera des offres promotionnelles exclusives pour la communauté Blob.
                </p>
                <p className="text-sm text-blue-800">
                  Au fur et à mesure du développement de la plateforme, nous proposerons des partenariats
                  avec des écoles de surf, des loueurs d&apos;équipement et d&apos;autres acteurs de la glisse.
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🤝</span>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-2">Vous êtes partenaire ?</h3>
                <p className="text-sm text-gray-700 mb-3">
                  Si vous êtes une école de surf, un loueur d&apos;équipement, ou un acteur de la glisse
                  intéressé par un partenariat, cet espace pourra accueillir vos offres promotionnelles.
                </p>
                <p className="text-xs text-gray-600 italic">
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
