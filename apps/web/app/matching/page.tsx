import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

export default function MatchingPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Matching</CardTitle>
          <CardDescription>Cette section affichera les partenaires proches selon ton profil et ta géolocalisation.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">À venir: carte interactive, filtres par niveau/disponibilités, et suggestions.</p>
        </CardContent>
      </Card>
    </div>
  );
}

