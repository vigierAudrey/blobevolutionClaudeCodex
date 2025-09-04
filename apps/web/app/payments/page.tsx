import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { BackBar } from '../../components/BackBar';
import { Button } from '../../components/ui/button';

export default function PaymentsPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <BackBar fallbackHref="/dashboard" />
      <Card>
        <CardHeader>
          <CardTitle>Paiements</CardTitle>
          <CardDescription>Ajoute du crédit à ton compte (Stripe à venir).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button variant="secondary">+10 €</Button>
            <Button variant="secondary">+25 €</Button>
            <Button variant="secondary">+50 €</Button>
          </div>
          <p className="text-sm text-muted-foreground mt-3">Intégration Stripe Connect et 3D Secure prévues dans la phase suivante.</p>
        </CardContent>
      </Card>
    </div>
  );
}
