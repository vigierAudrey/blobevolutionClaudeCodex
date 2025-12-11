import Link from 'next/link';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Sparkles } from 'lucide-react';

export default function ReservationsHome() {
  return (
    <div className="space-y-6 pb-10">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-500 to-purple-500 p-8 text-white shadow-xl">
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.35),_transparent_55%)]" aria-hidden />
        <div className="relative z-10 space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            <Sparkles className="w-3.5 h-3.5" />
            Module reservations
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Commencer une réservation</h2>
          <p className="text-white/85 text-sm sm:text-base max-w-2xl">
            Ce module te guidera bientôt pour sélectionner un sport, une zone d’activité et envoyer une demande complète à un pro.
          </p>
          <Button asChild variant="secondary" className="bg-white text-indigo-600 hover:bg-white/90">
            <Link href="/reservations/start">Lancer le parcours</Link>
          </Button>
        </div>
      </section>

      <section className="space-y-3 border rounded-2xl p-5 bg-muted/40">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-white text-slate-700">Roadmap</Badge>
          <h3 className="text-sm font-semibold uppercase text-muted-foreground">Ce que tu pourras faire bientôt</h3>
        </div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>Filtrer les pros par sport, niveau et distance.</li>
          <li>Visualiser les disponibilités sur une carte et une liste.</li>
          <li>Envoyer une demande de session avec message personnalisé.</li>
          <li>Suivre tes demandes en attente et tes sessions confirmées.</li>
        </ul>
      </section>
    </div>
  );
}
