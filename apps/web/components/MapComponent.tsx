"use client";
import { useEffect } from 'react';
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
  }>;
  onContactClick: (userId: string) => void;
};

export default function MapComponent({ center, items, onContactClick }: MapComponentProps) {
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

  return (
    <MapContainer center={center} zoom={11} style={mapStyle} scrollWheelZoom>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      {items.map((item) => (
        <Marker key={item.id} position={[item.lat, item.lng]}>
          <Popup>
            <div className="text-sm">
              <div className="font-medium">{item.displayName || 'Rider'}</div>
              <div className="text-gray-600">à ~{item.distanceKm} km</div>
              <div className="mt-2">
                <button
                  className="underline text-blue-600 hover:text-blue-800"
                  onClick={() => onContactClick(item.userId)}
                >
                  Contacter
                </button>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}