import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { BackBar } from '../../components/BackBar';

export default function PromosPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <BackBar fallbackHref="/dashboard" />
      <Card>
        <CardHeader>
          <CardTitle>Offres promotionnelles</CardTitle>
          <CardDescription>Retrouve ici des promos temporaires sur les sessions et équipements.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-5 text-sm">
            <li>-10% sur ta prochaine session (code: BLOB10)</li>
            <li>Parraine un ami: 5€ offerts chacun</li>
            <li>Pack découverte Kite: -15% jusqu’à dimanche</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
