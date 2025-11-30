import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Hall of Fame - Blobinfini Security',
  description: 'Nos contributeurs sécurité - Chercheurs qui ont aidé à sécuriser Blobinfini',
};

// Type pour un contributeur
interface SecurityContributor {
  name: string;
  vulnerabilityType: string;
  severity: 'High' | 'Medium' | 'Low';
  date: string;
  website?: string;
  twitter?: string;
  github?: string;
  linkedin?: string;
}

// Liste des contributeurs (vide au début, à remplir au fur et à mesure)
const contributors2025: SecurityContributor[] = [
  // Exemple de structure (à supprimer quand vous aurez de vrais contributeurs) :
  // {
  //   name: "JohnDoe",
  //   vulnerabilityType: "XSS réfléchi sur endpoint /api/auth/login",
  //   severity: "Medium",
  //   date: "2025-12-15",
  //   github: "https://github.com/johndoe",
  //   linkedin: "https://linkedin.com/in/johndoe"
  // }
];

const contributors2024: SecurityContributor[] = [];

function getSeverityColor(severity: string) {
  switch (severity) {
    case 'High':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'Medium':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'Low':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
}

function ContributorCard({ contributor }: { contributor: SecurityContributor }) {
  return (
    <div className="bg-white border-2 border-gray-200 rounded-lg p-6 hover:border-blue-400 hover:shadow-lg transition-all">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-xl font-bold text-gray-900">{contributor.name}</h3>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getSeverityColor(contributor.severity)}`}>
          {contributor.severity}
        </span>
      </div>

      <p className="text-gray-700 mb-4 text-sm leading-relaxed">
        {contributor.vulnerabilityType}
      </p>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          📅 {new Date(contributor.date).toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </p>

        <div className="flex space-x-2">
          {contributor.github && (
            <a
              href={contributor.github}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-gray-900 transition-colors"
              title="GitHub"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
            </a>
          )}
          {contributor.twitter && (
            <a
              href={contributor.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-blue-400 transition-colors"
              title="Twitter"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          )}
          {contributor.linkedin && (
            <a
              href={contributor.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-blue-600 transition-colors"
              title="LinkedIn"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
            </a>
          )}
          {contributor.website && (
            <a
              href={contributor.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-green-600 transition-colors"
              title="Website"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SecurityHallOfFamePage() {
  const totalContributors = contributors2025.length + contributors2024.length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            🏆 Hall of Fame
          </h1>
          <p className="text-xl text-gray-600 mb-6">
            Nos héros de la cybersécurité
          </p>
          <p className="text-gray-700 max-w-2xl mx-auto">
            Ces chercheurs en sécurité ont contribué à rendre Blobinfini plus sûr.
            Nous les remercions chaleureusement pour leur travail et leur divulgation responsable.
          </p>

          <div className="mt-8 flex justify-center space-x-6">
            <div className="bg-white rounded-lg shadow p-4 min-w-[120px]">
              <p className="text-3xl font-bold text-blue-600">{totalContributors}</p>
              <p className="text-sm text-gray-600">Contributeurs</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 min-w-[120px]">
              <p className="text-3xl font-bold text-green-600">
                {contributors2025.filter(c => c.severity === 'High').length +
                 contributors2024.filter(c => c.severity === 'High').length}
              </p>
              <p className="text-sm text-gray-600">Vulnérabilités High</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 min-w-[120px]">
              <p className="text-3xl font-bold text-orange-600">
                {contributors2025.filter(c => c.severity === 'Medium').length +
                 contributors2024.filter(c => c.severity === 'Medium').length}
              </p>
              <p className="text-sm text-gray-600">Vulnérabilités Medium</p>
            </div>
          </div>
        </div>

        {/* 2025 Contributors */}
        {contributors2025.length > 0 ? (
          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">2025</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {contributors2025.map((contributor, index) => (
                <ContributorCard key={index} contributor={contributor} />
              ))}
            </div>
          </section>
        ) : (
          <section className="mb-12">
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-dashed border-blue-300 rounded-lg p-12 text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Soyez le premier contributeur !
              </h2>
              <p className="text-gray-700 mb-6 max-w-md mx-auto">
                Notre programme de bug bounty vient de démarrer. Aidez-nous à sécuriser Blobinfini
                et devenez le premier membre de notre Hall of Fame !
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Link
                  href="/security-policy"
                  className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                >
                  Voir la politique de sécurité
                </Link>
                <a
                  href="/.well-known/security.txt"
                  className="inline-block bg-gray-200 text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
                >
                  Consulter security.txt
                </a>
              </div>
            </div>
          </section>
        )}

        {/* 2024 Contributors */}
        {contributors2024.length > 0 && (
          <section className="mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">2024</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {contributors2024.map((contributor, index) => (
                <ContributorCard key={index} contributor={contributor} />
              ))}
            </div>
          </section>
        )}

        {/* Comment devenir contributeur */}
        <section className="bg-gray-900 text-white rounded-lg p-8 mb-12">
          <h2 className="text-2xl font-bold mb-4">💡 Comment apparaître ici ?</h2>
          <ol className="space-y-3">
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-sm font-bold mr-3">1</span>
              <span>Trouvez une vulnérabilité de sécurité sur Blobinfini (dans le scope autorisé)</span>
            </li>
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-sm font-bold mr-3">2</span>
              <span>Signalez-la de manière responsable à <a href="mailto:security@blobinfini.fr" className="text-blue-300 hover:underline">security@blobinfini.fr</a></span>
            </li>
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-sm font-bold mr-3">3</span>
              <span>Attendez notre correction et validation</span>
            </li>
            <li className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-sm font-bold mr-3">4</span>
              <span>Recevez votre récompense et acceptez d'apparaître dans le Hall of Fame</span>
            </li>
          </ol>
          <div className="mt-6 pt-6 border-t border-gray-700">
            <p className="text-sm text-gray-400">
              <strong>Note :</strong> Votre présence dans le Hall of Fame est optionnelle et nécessite votre consentement.
              Vous pouvez choisir d'être anonyme ou d'utiliser un pseudonyme.
            </p>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center">
          <Link
            href="/"
            className="text-blue-600 hover:underline font-medium"
          >
            ← Retour à l'accueil
          </Link>
          <p className="text-sm text-gray-500 mt-4">
            Dernière mise à jour : 30 novembre 2025
          </p>
        </footer>
      </div>
    </div>
  );
}
