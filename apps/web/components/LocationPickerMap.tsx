"use client";

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

type LocationPickerMapProps = {
  value: { lat: number; lng: number } | null;
  onChange: (coords: { lat: number; lng: number }) => void;
  defaultCenter?: [number, number];
  draggableMarker?: boolean;
};

// Ensure Leaflet default icons load correctly in Next.js
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

export default function LocationPickerMap({
  value,
  onChange,
  defaultCenter = [43.493, -1.558],
  draggableMarker = false,
}: LocationPickerMapProps) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.crossOrigin = '';
    document.head.appendChild(link);
    return () => {
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
    };
  }, []);

  const center = value ? ([value.lat, value.lng] as [number, number]) : defaultCenter;

  const markerIcon = useMemo(
    () =>
      L.divIcon({
        className: 'map-marker-icon',
        html: `
          <div style="
            width: 22px;
            height: 22px;
            border-radius: 9999px;
            background: #2563eb;
            border: 2px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            transform: translate(-50%, -50%);
          "></div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
    []
  );

  return (
    <MapContainer
      center={center}
      zoom={value ? 13 : 11}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
      <FlyToMarker center={center} />
      <SelectionMarker value={value} onChange={onChange} icon={markerIcon} draggable={draggableMarker} />
    </MapContainer>
  );
}

type FlyToMarkerProps = {
  center: [number, number];
};

function FlyToMarker({ center }: FlyToMarkerProps) {
  const map = useMap();

  useEffect(() => {
    map.setView(center);
  }, [map, center]);

  return null;
}

type SelectionMarkerProps = {
  value: { lat: number; lng: number } | null;
  onChange: (coords: { lat: number; lng: number }) => void;
  icon: L.DivIcon;
  draggable: boolean;
};

function SelectionMarker({ value, onChange, icon, draggable }: SelectionMarkerProps) {
  const map = useMapEvents({
    click(event) {
      const lat = Number(event.latlng.lat.toFixed(6));
      const lng = Number(event.latlng.lng.toFixed(6));
      onChange({ lat, lng });
      map.flyTo([lat, lng], map.getZoom());
    },
  });

  useEffect(() => {
    if (value) {
      map.setView([value.lat, value.lng]);
    }
  }, [map, value]);

  if (!value) {
    return null;
  }

  return (
    <Marker
      position={[value.lat, value.lng]}
      icon={icon}
      draggable={draggable}
      eventHandlers={{
        dragend(event) {
          const target = event.target;
          if (target instanceof L.Marker) {
            const latLng = target.getLatLng();
            const lat = Number(latLng.lat.toFixed(6));
            const lng = Number(latLng.lng.toFixed(6));
            onChange({ lat, lng });
          }
        },
      }}
    />
  );
}
