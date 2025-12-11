import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { BackBar } from '../../components/BackBar';
import { Badge } from '../../components/ui/badge';
import { Sparkles } from 'lucide-react';

export default function PromosPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-10">
      <BackBar fallbackHref="/dashboard" />

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-500 p-8 text-white shadow-xl">
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.35),_transparent_55%)]" aria-hidden />
        <div className="relative z-10 space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            <Sparkles className="w-3.5 h-3.5" />
            Partenariats
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Offres promotionnelles</h1>
          <p className="text-white/85 text-base">
            Nous préparons des deals exclusifs avec écoles, loueurs et acteurs de la glisse. Revenez bientôt pour profiter des premiers packs.
          </p>
        </div>
      </section>

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
                  Cette section accueillera des offres promotionnelles exclusives pour la communauté BlobConnect.
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
