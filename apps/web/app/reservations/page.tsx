import Link from 'next/link';
import { Button } from '../../components/ui/button';

export default function ReservationsHome() {
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Commencer une réservation</h2>
        <p className="text-muted-foreground text-sm">
          Ce module te guide pour sélectionner un sport, une zone d’activité et envoyer une demande à un pro.
        </p>
        <Button asChild>
          <Link href="/reservations/start">Lancer le parcours</Link>
        </Button>
      </section>

      <section className="space-y-3 border rounded-lg p-4">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">Ce que tu pourras faire bientôt</h3>
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
