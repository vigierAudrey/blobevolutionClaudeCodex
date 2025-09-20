"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle } from 'react-leaflet';
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
    isDisabled?: boolean;
    disabledReason?: string;
  }>;
  onContactClick: (userId: string) => void;
  legend?: Array<{ label: string; color: string }>;
  centerMarker?: {
    label?: string;
    description?: string;
  };
  showCenterMarker?: boolean;
  radiusKm?: number;
};

export default function MapComponent({
  center,
  items,
  onContactClick,
  legend,
  centerMarker,
  showCenterMarker = true,
  radiusKm,
}: MapComponentProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const legendButtonRef = useRef<HTMLButtonElement | null>(null);

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

  const zoom = useMemo(() => {
    if (!radiusKm) return 11;
    if (radiusKm <= 10) return 12;
    if (radiusKm <= 20) return 11;
    if (radiusKm <= 40) return 10;
    if (radiusKm <= 70) return 9;
    return 8;
  }, [radiusKm]);

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

  useEffect(() => {
    if (!legendOpen) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLegendOpen(false);
      }
    };
    const closeOnClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const legendElement = legendRef.current;
      const buttonElement = legendButtonRef.current;
      if (!legendElement) return;
      if (legendElement.contains(target)) return;
      if (buttonElement?.contains(target)) return;
      setLegendOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('mousedown', closeOnClickOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('mousedown', closeOnClickOutside);
    };
  }, [legendOpen]);

  const bounds = useMemo(() => {
    if (!center) return null;
    const points: Array<[number, number]> = [[center[0], center[1]]];
    for (const item of items) {
      points.push([item.lat, item.lng]);
    }
    if (radiusKm && radiusKm > 0) {
      const latRadius = radiusKm / 111.32;
      const lngRadius = radiusKm /
        (111.32 * Math.max(Math.cos((center[0] * Math.PI) / 180), 0.0001));
      points.push([center[0] + latRadius, center[1] + lngRadius]);
      points.push([center[0] - latRadius, center[1] - lngRadius]);
    }
    if (points.length < 2) return null;
    return L.latLngBounds(points.map(([lat, lng]) => ({ lat, lng })));
  }, [center, items, radiusKm]);

  return (
    <div className="relative">
      {legend && legend.length > 0 && (
        <div className="absolute left-3 top-3 z-[1000] text-xs">
          <button
            type="button"
            className="md:hidden rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-700 shadow"
            onClick={() => setLegendOpen((value) => !value)}
            aria-expanded={legendOpen}
            aria-controls="map-legend"
            aria-label={legendOpen ? 'Masquer la légende de la carte' : 'Afficher la légende de la carte'}
            ref={legendButtonRef}
          >
            {legendOpen ? 'Masquer la légende' : 'Afficher la légende'}
          </button>

          <div
            id="map-legend"
            ref={legendRef}
            role="status"
            aria-live="polite"
            className={`mt-2 space-y-2 rounded-md bg-white/90 px-3 py-2 shadow ${legendOpen ? 'block' : 'hidden md:block'}`}
          >
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
            {radiusKm && (
              <p className="text-[10px] text-muted-foreground">
                Rayon de recherche : {radiusKm} km
              </p>
            )}
          </div>
        </div>
      )}

      <MapContainer center={center} zoom={zoom} style={mapStyle} scrollWheelZoom>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        <MapViewUpdater center={center} zoom={zoom} bounds={bounds} />
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
        {radiusKm && radiusKm > 0 && (
          <Circle
            center={center}
            radius={radiusKm * 1000}
            pathOptions={{ color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.08 }}
          />
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
                    <div className="group relative inline-flex">
                      <button
                        className="underline text-primary hover:text-primary/80 disabled:cursor-not-allowed disabled:text-muted-foreground"
                        onClick={() => onContactClick(item.userId)}
                        disabled={item.isDisabled}
                        title={item.disabledReason ?? 'Demander ce créneau'}
                      >
                        Demander ce créneau
                      </button>
                      <span
                        className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden w-40 -translate-x-1/2 rounded bg-slate-900 px-2 py-1 text-center text-[10px] text-white shadow group-hover:block group-focus-within:block"
                      >
                        {item.isDisabled ? item.disabledReason : 'Ouvre la demande pour ce créneau.'}
                      </span>
                    </div>
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

type MapViewUpdaterProps = {
  center: [number, number];
  zoom: number;
  bounds: L.LatLngBounds | null;
};

function MapViewUpdater({ center, zoom, bounds }: MapViewUpdaterProps) {
  const map = useMap();
  const boundsKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (bounds) {
      const key = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
      if (boundsKeyRef.current === key) {
        return;
      }
      boundsKeyRef.current = key;
      map.flyToBounds(bounds, { animate: true, padding: [40, 40], maxZoom: zoom });
      return;
    }

    boundsKeyRef.current = null;
    map.setView(center, zoom, { animate: true });
  }, [map, center, zoom, bounds]);

  return null;
}
