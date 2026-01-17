"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle } from 'react-leaflet';
import L from 'leaflet';

// Fix pour les icônes Leaflet dans Next.js
// Type assertion pour accéder à la propriété privée _getIconUrl de Leaflet
interface LeafletIconPrototype {
  _getIconUrl?: () => string;
}
const defaultIconPrototype = L.Icon.Default.prototype as LeafletIconPrototype;
delete defaultIconPrototype._getIconUrl;
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
    lessonSport?: string | null;
    lessonLevel?: string | null;
    lessonDate?: Date | string | null;
    lessonPlace?: string | null;
    lessonStudentCount?: number | null;
  }>;
  onContactClick: (userId: string) => void;
  highlightedItemId?: string | null;
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
  highlightedItemId,
  legend,
  centerMarker,
  showCenterMarker = true,
  radiusKm,
}: MapComponentProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const legendButtonRef = useRef<HTMLButtonElement | null>(null);

  // Cache CSS loading to avoid reloading on every component mount
  useEffect(() => {
    if (typeof window !== 'undefined' && !document.querySelector('link[href*="leaflet.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.crossOrigin = '';
      link.as = 'style';
      document.head.appendChild(link);

      // Add mobile-specific styles for better touch interaction
      const style = document.createElement('style');
      style.textContent = `
        /* Mobile optimizations for Leaflet map */
        .leaflet-container {
          touch-action: pan-x pan-y !important;
        }

        /* Bigger zoom controls for mobile */
        @media (max-width: 768px) {
          .leaflet-control-zoom a {
            width: 44px !important;
            height: 44px !important;
            line-height: 44px !important;
            font-size: 18px !important;
          }

          .leaflet-control-zoom {
            margin: 20px !important;
          }

          /* Better popup positioning on mobile */
          .mobile-optimized-popup .leaflet-popup-content {
            margin: 8px 12px !important;
            line-height: 1.4 !important;
          }

          .mobile-optimized-popup .leaflet-popup-content-wrapper {
            border-radius: 8px !important;
          }

          /* Marker hover effects */
          .map-marker-icon div:hover {
            transform: translate(-50%, -50%) scale(1.1) !important;
          }
        }

        /* Disable text selection on map */
        .leaflet-container {
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Adaptive height for mobile vs desktop
  const mapStyle = useMemo(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    return {
      height: isMobile ? '50vh' : '60vh',
      width: '100%',
      touchAction: 'none', // Optimize touch performance
    } as const;
  }, []);

  const zoom = useMemo(() => {
    if (!radiusKm) return 11;
    if (radiusKm <= 10) return 12;
    if (radiusKm <= 20) return 11;
    if (radiusKm <= 40) return 10;
    if (radiusKm <= 70) return 9;
    return 8;
  }, [radiusKm]);

  const markerIcons = useMemo(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const size = isMobile ? 28 : 20; // Bigger markers for touch
    const border = isMobile ? 3 : 2;

    const createIcon = (color: string, highlighted = false) => {
      const finalSize = highlighted ? size * 1.8 : size;
      const finalBorder = highlighted ? border * 1.5 : border;

      return L.divIcon({
        className: 'map-marker-icon',
        html: `
          <div style="
            width: ${finalSize}px;
            height: ${finalSize}px;
            border-radius: 9999px;
            background: ${color};
            border: ${finalBorder}px solid white;
            box-shadow: ${highlighted ? '0 4px 16px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.3)'};
            transform: translate(-50%, -50%);
            cursor: pointer;
            transition: all 0.2s ease;
            ${highlighted ? 'animation: bounce 1s infinite;' : ''}
          "></div>
          ${highlighted ? `
          <style>
            @keyframes bounce {
              0%, 100% { transform: translate(-50%, -50%) scale(1); }
              50% { transform: translate(-50%, -55%) scale(1.1); }
            }
          </style>
          ` : ''}
        `,
        iconSize: [finalSize, finalSize],
        iconAnchor: [finalSize / 2, finalSize / 2],
        popupAnchor: [0, -finalSize / 2],
      });
    };

    return {
      availability: createIcon('#2563eb'),
      rider: createIcon('#16a34a'),
      default: createIcon('#f97316'),
      center: createIcon('#0ea5e9'),
      availabilityHighlighted: createIcon('#2563eb', true),
      riderHighlighted: createIcon('#16a34a', true),
      defaultHighlighted: createIcon('#f97316', true),
    } satisfies Record<'availability' | 'rider' | 'default' | 'center' | 'availabilityHighlighted' | 'riderHighlighted' | 'defaultHighlighted', L.DivIcon>;
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
        <div className="absolute left-3 bottom-3 z-[1000] text-xs md:left-3 md:bottom-3">
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

      <MapContainer
        center={center}
        zoom={zoom}
        style={mapStyle}
        scrollWheelZoom={false} // Disable on mobile for better touch
        touchZoom={true}
        doubleClickZoom={true}
        zoomControl={true}
        dragging={true}
        zoomSnap={0.5}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={100}
        maxBounds={[[-90, -180], [90, 180]]} // Prevent infinite panning
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
          maxZoom={18}
          tileSize={256}
          detectRetina={true}
          updateWhenIdle={true} // Better performance on mobile
          keepBuffer={2} // Reduce memory usage
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
          const isHighlighted = item.id === highlightedItemId;
          const iconKey = isHighlighted
            ? (`${type}Highlighted` as 'availabilityHighlighted' | 'riderHighlighted' | 'defaultHighlighted')
            : type;
          const icon = markerIcons[iconKey] ?? markerIcons[type] ?? markerIcons.default;
          return (
            <Marker key={item.id} position={[item.lat, item.lng]} icon={icon} zIndexOffset={isHighlighted ? 1000 : 0}>
              <Popup
                minWidth={200}
                maxWidth={300}
                className="mobile-optimized-popup"
                closeButton={true}
                autoPan={true}
                keepInView={true}
              >
                <div className="text-sm p-1">
                  <div className="font-medium text-base mb-1">{item.displayName || 'Rider'}</div>
                  {item.distanceKm != null && (
                    <div className="text-muted-foreground text-xs mb-2">📍 À ~{item.distanceKm.toFixed(1)} km</div>
                  )}

                  {/* Lesson details */}
                  {(item.lessonSport || item.lessonLevel || item.lessonDate || item.lessonPlace || item.lessonStudentCount) && (
                    <div className="mb-3 p-2 bg-blue-50 rounded text-xs space-y-1">
                      {item.lessonStudentCount && item.lessonStudentCount > 0 && (
                        <div>
                          <span className="font-medium">Groupe:</span> {item.lessonStudentCount} {item.lessonStudentCount > 1 ? 'personnes' : 'personne'}
                        </div>
                      )}
                      {item.lessonSport && (
                        <div>
                          <span className="font-medium">Sport:</span> {item.lessonSport === 'surf' ? '🏄 Surf' : '🪁 Kitesurf'}
                        </div>
                      )}
                      {item.lessonLevel && (
                        <div>
                          <span className="font-medium">Niveau:</span> {
                            item.lessonLevel === 'beginner' ? 'Débutant' :
                            item.lessonLevel === 'intermediate' ? 'Intermédiaire' :
                            'Confirmé'
                          }
                        </div>
                      )}
                      {item.lessonDate && (
                        <div>
                          <span className="font-medium">Date:</span> {new Date(item.lessonDate).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })}
                        </div>
                      )}
                      {item.lessonPlace && (
                        <div>
                          <span className="font-medium">Lieu:</span> {item.lessonPlace}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <button
                      className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium touch-manipulation"
                      onClick={() => onContactClick(item.userId)}
                      disabled={item.isDisabled}
                      style={{ minHeight: '44px' }} // iOS touch target recommendation
                    >
                      {item.isDisabled ? '❌ Indisponible' : '💬 Contacter'}
                    </button>
                    {item.isDisabled && item.disabledReason && (
                      <div className="mt-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                        {item.disabledReason}
                      </div>
                    )}
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
