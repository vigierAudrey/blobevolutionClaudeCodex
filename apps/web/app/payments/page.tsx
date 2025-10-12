import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { BackBar } from '../../components/BackBar';

export default function PaymentsPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <BackBar fallbackHref="/dashboard" />
      <Card>
        <CardHeader>
          <CardTitle>Paiements désactivés</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Les paiements en ligne et l’achat de crédits sont momentanément indisponibles.</p>
          <p>Nous vous avertirons dès que le service Stripe sera de nouveau activé.</p>
        </CardContent>
      </Card>
    </div>
  );
}
