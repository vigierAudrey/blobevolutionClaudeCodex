"use client";
import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// Fix pour les icônes Leaflet dans Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

type MapComponentProps = {
  center: [number, number];
  items: Array<{
    id: string;
    lat: number;
    lng: number;
    displayName?: string;
    distanceKm?: number;
    userId: string;
    type?: 'availability' | 'rider' | 'default';
  }>;
  onContactClick: (userId: string) => void;
  legend?: Array<{ label: string; color: string }>;
  centerMarker?: {
    label?: string;
    description?: string;
  };
  showCenterMarker?: boolean;
};

export default function MapComponent({
  center,
  items,
  onContactClick,
  legend,
  centerMarker,
  showCenterMarker = true,
}: MapComponentProps) {
  useEffect(() => {
    // Charger le CSS de Leaflet côté client
    if (typeof window !== 'undefined') {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.crossOrigin = '';
      document.head.appendChild(link);

      return () => {
        document.head.removeChild(link);
      };
    }
  }, []);

  const mapStyle = { height: '60vh', width: '100%' } as const;

  const markerIcons = useMemo(() => {
    const createIcon = (color: string) =>
      L.divIcon({
        className: 'map-marker-icon',
        html: `
          <div style="
            width: 20px;
            height: 20px;
            border-radius: 9999px;
            background: ${color};
            border: 2px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            transform: translate(-50%, -50%);
          "></div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -10],
      });

    return {
      availability: createIcon('#2563eb'),
      rider: createIcon('#16a34a'),
      default: createIcon('#f97316'),
      center: createIcon('#0ea5e9'),
    } satisfies Record<'availability' | 'rider' | 'default' | 'center', L.DivIcon>;
  }, []);

  return (
    <div className="relative">
      {legend && legend.length > 0 && (
        <div className="absolute left-3 top-3 z-[1000] space-y-2 rounded-md bg-white/90 px-3 py-2 text-xs shadow">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Légende</p>
          <ul className="space-y-1">
            {legend.map((item) => (
              <li key={item.label} className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full border"
                  style={{ backgroundColor: item.color, borderColor: item.color }}
                />
                <span className="text-muted-foreground">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <MapContainer center={center} zoom={11} style={mapStyle} scrollWheelZoom>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {showCenterMarker && (
          <Marker position={center} icon={markerIcons.center}>
            {centerMarker && (
              <Popup>
                <div className="text-sm">
                  <div className="font-medium">{centerMarker.label || 'Position actuelle'}</div>
                  {centerMarker.description && (
                    <div className="text-muted-foreground text-xs mt-1">{centerMarker.description}</div>
                  )}
                </div>
              </Popup>
            )}
          </Marker>
        )}
        {items.map((item) => {
          const type = item.type ?? 'default';
          const icon = markerIcons[type] ?? markerIcons.default;
          return (
            <Marker key={item.id} position={[item.lat, item.lng]} icon={icon}>
              <Popup>
                <div className="text-sm">
                  <div className="font-medium">{item.displayName || 'Rider'}</div>
                  {item.distanceKm != null && (
                    <div className="text-muted-foreground text-xs">à ~{item.distanceKm.toFixed(1)} km</div>
                  )}
                  <div className="mt-2">
                    <button
                      className="underline text-primary hover:text-primary/80"
                      onClick={() => onContactClick(item.userId)}
                    >
                      Contacter
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
