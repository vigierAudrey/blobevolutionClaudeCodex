import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Politique de Sécurité · Blob',
  description: 'Politique de divulgation responsable des vulnérabilités de Blob',
};

const SECURITY_EMAIL = 'security@blobsurf.com';

export default function SecurityPolicyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            🔒 Politique de Sécurité
          </h1>
          <p className="text-xl text-gray-600">
            Divulgation responsable des vulnérabilités
          </p>
        </div>

        <div className="bg-white shadow-lg rounded-lg p-8 space-y-8">

          {/* Introduction */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Notre Engagement
            </h2>
            <p className="text-gray-700 leading-relaxed">
              Chez <strong>Blob</strong>, la sécurité de nos utilisateurs est notre priorité absolue.
              Nous encourageons les chercheurs en sécurité à nous aider à identifier et corriger
              les vulnérabilités de manière responsable.
            </p>
          </section>

          {/* Responsible disclosure */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Signalement responsable
            </h2>

            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-6">
              <p className="text-sm text-blue-900">
                Si vous identifiez une vulnérabilité sur Blob, contactez-nous à{' '}
                <a href={`mailto:${SECURITY_EMAIL}`} className="font-semibold underline">
                  {SECURITY_EMAIL}
                </a>{' '}
                avec les informations utiles pour reproduire et évaluer le problème.
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-2">À inclure dans votre signalement</h3>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                <li>URL ou surface concernée</li>
                <li>Étapes de reproduction</li>
                <li>Impact potentiel</li>
                <li>Captures ou preuve de concept non destructive, si utile</li>
              </ul>
            </div>
          </section>

          {/* Scope */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              🎯 Périmètre des Tests (Scope)
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="border-2 border-green-300 rounded-lg p-4 bg-green-50">
                <h3 className="font-semibold text-green-900 mb-3 flex items-center">
                  <span className="text-2xl mr-2">✅</span> Autorisé
                </h3>
                <ul className="space-y-2 text-sm text-green-800">
                  <li>• API publique : <code className="bg-white px-2 py-1 rounded">/api/auth/*</code></li>
                  <li>• API publique : <code className="bg-white px-2 py-1 rounded">/api/public/*</code></li>
                  <li>• Application web : <code className="bg-white px-2 py-1 rounded">https://blobsurf.com/*</code></li>
                  <li>• Tests sur vos propres comptes uniquement</li>
                </ul>
              </div>

              <div className="border-2 border-red-300 rounded-lg p-4 bg-red-50">
                <h3 className="font-semibold text-red-900 mb-3 flex items-center">
                  <span className="text-2xl mr-2">❌</span> Interdit
                </h3>
                <ul className="space-y-2 text-sm text-red-800">
                  <li>• Endpoints admin : <code className="bg-white px-2 py-1 rounded">/admin/*</code></li>
                  <li>• Données d&apos;autres utilisateurs</li>
                  <li>• Attaques DoS/DDoS</li>
                  <li>• Social engineering</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Règles d'Engagement */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              📋 Règles d&apos;Engagement
            </h2>
            <ol className="space-y-3">
              {[
                "Créez vos propres comptes de test - Ne testez jamais sur des comptes réels",
                "Respectez la confidentialité - Ne divulguez pas de données personnelles découvertes",
                "Divulgation responsable - Accordez-nous 90 jours pour corriger avant publication",
                `Communication responsable - Utilisez ${SECURITY_EMAIL}`,
                "Une vulnérabilité à la fois - Signalez chaque faille individuellement",
                "Fournissez des détails - Steps to reproduce, impact, proof of concept"
              ].map((rule, index) => (
                <li key={index} className="flex items-start">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3">
                    {index + 1}
                  </span>
                  <span className="text-gray-700">{rule}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Processus */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              🔄 Processus de Divulgation
            </h2>
            <div className="space-y-4">
              {[
                { step: 1, title: "Signalement", desc: `Envoyez un email à ${SECURITY_EMAIL} avec les détails`, time: "" },
                { step: 2, title: "Accusé de réception", desc: "Nous confirmons la réception dès que possible", time: "" },
                { step: 3, title: "Évaluation", desc: "Nous validons la vulnérabilité et évaluons la criticité", time: "< 7 jours" },
                { step: 4, title: "Correction", desc: "High: 14j, Medium: 30j, Low: 90j", time: "Selon criticité" },
                { step: 5, title: "Clôture", desc: "Nous vous tenons informé de l'issue du signalement", time: "Après correction" }
              ].map((item) => (
                <div key={item.step} className="flex items-start bg-gray-50 rounded-lg p-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-lg mr-4">
                    {item.step}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900">{item.title}</h4>
                    <p className="text-sm text-gray-600">{item.desc}</p>
                    {item.time && <p className="text-xs text-blue-600 font-medium mt-1">{item.time}</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Hors Scope */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              🚫 Vulnérabilités Hors Scope
            </h2>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-gray-700 mb-3">Les vulnérabilités suivantes sont hors périmètre :</p>
              <ul className="grid md:grid-cols-2 gap-2 text-sm text-gray-600">
                {[
                  "SPF, DKIM, DMARC (configuration email)",
                  "SSL/TLS configuration",
                  "Clickjacking (X-Frame-Options: DENY)",
                  "Absence de rate limiting (déjà implémenté)",
                  "Vulnérabilités physiques",
                  "Bugs fonctionnels sans impact sécurité"
                ].map((item, index) => (
                  <li key={index} className="flex items-start">
                    <span className="text-gray-400 mr-2">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Conformité Légale */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              ⚖️ Conformité Légale (France)
            </h2>

            <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-4">
              <h3 className="font-semibold text-yellow-900 mb-2">Code Pénal Article 323-1</h3>
              <p className="text-sm text-yellow-800">
                L&apos;accès frauduleux à un système informatique est puni de 2 ans d&apos;emprisonnement
                et de 60 000€ d&apos;amende. Cette page décrit un cadre de signalement responsable ;
                elle ne remplace pas un accord juridique individuel.
              </p>
            </div>

            <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
              <h3 className="font-semibold text-blue-900 mb-2">RGPD & Données Personnelles</h3>
              <p className="text-sm text-blue-800">
                Ne pas exfiltrer, divulguer ou conserver de données personnelles. En cas de découverte
                accidentelle, contactez immédiatement <code>{SECURITY_EMAIL}</code>.
              </p>
            </div>
          </section>

          {/* Contact */}
          <section className="bg-gray-900 text-white rounded-lg p-6">
            <h2 className="text-2xl font-semibold mb-4">📧 Contact</h2>
            <div className="space-y-3">
              <p>
                <strong>Email de sécurité :</strong>{' '}
                <a href={`mailto:${SECURITY_EMAIL}`} className="text-blue-300 hover:underline">
                  {SECURITY_EMAIL}
                </a>
              </p>
              <p>
                <strong>Fichier security.txt :</strong>{' '}
                <a href="/.well-known/security.txt" className="text-blue-300 hover:underline">
                  /.well-known/security.txt
                </a>
              </p>
              <p>
                <strong>Hall of Fame :</strong>{' '}
                <Link href="/security-hall-of-fame" className="text-blue-300 hover:underline">
                  /security-hall-of-fame
                </Link>
              </p>
              <p className="text-sm text-gray-400 mt-4">
                Nous traitons les signalements de sécurité de manière responsable et priorisée.
              </p>
            </div>
          </section>

          {/* Footer */}
          <footer className="text-center pt-8 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              Politique mise à jour le 30 novembre 2025 • Conforme RFC 9116
            </p>
            <div className="mt-4">
              <Link
                href="/"
                className="text-blue-600 hover:underline text-sm font-medium"
              >
                ← Retour à l&apos;accueil
              </Link>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
