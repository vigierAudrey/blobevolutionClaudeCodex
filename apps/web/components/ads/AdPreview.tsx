'use client';

/**
 * Composant de prévisualisation des publicités
 * À utiliser en développement pour voir les emplacements des pubs
 */
export function AdPreview({
  slot,
  className = ''
}: {
  slot: string;
  className?: string;
}) {
  const enabled = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true';
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;

  if (!enabled || !clientId) {
    return (
      <div className={`border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500 ${className}`}>
        <div className="space-y-1">
          <div className="font-medium">📊 Emplacement publicité</div>
          <div className="text-xs">Slot: {slot}</div>
          <div className="text-xs">AdSense: {enabled ? 'Activé' : 'Désactivé'}</div>
          {!clientId && <div className="text-xs text-red-500">Client ID manquant</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={`border border-blue-200 bg-blue-50 p-2 text-center text-xs text-blue-600 ${className}`}>
      <div>🎯 AdSense chargé</div>
      <div>Slot: {slot}</div>
    </div>
  );
}