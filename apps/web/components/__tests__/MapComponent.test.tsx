import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import MapComponent from '../MapComponent';

jest.mock('leaflet', () => {
  const latLngBounds = (points: Array<{ lat: number; lng: number }>) => {
    const lats = points.map((point) => point.lat);
    const lngs = points.map((point) => point.lng);
    return {
      getSouth: () => Math.min(...lats),
      getNorth: () => Math.max(...lats),
      getWest: () => Math.min(...lngs),
      getEast: () => Math.max(...lngs),
    };
  };

  class FakeIconDefault {}
  Object.assign(FakeIconDefault.prototype, { _getIconUrl: jest.fn() });
  (FakeIconDefault as unknown).mergeOptions = jest.fn();

  return {
    __esModule: true,
    default: {
      Icon: {
        Default: FakeIconDefault,
      },
      divIcon: jest.fn((options: unknown) => ({ options })),
      latLngBounds,
    },
    divIcon: jest.fn((options: unknown) => ({ options })),
    latLngBounds,
  };
});

jest.mock('react-leaflet', () => {
  const React = require('react');
  const mapInstance = {
    flyToBounds: jest.fn(),
    setView: jest.fn(),
    flyTo: jest.fn(),
    getZoom: jest.fn(() => 12),
  };
  const mapEventsHandlers: { current: Record<string, (...args: unknown[]) => void> | null } = {
    current: null,
  };
  const markerInstances: Array<{ eventHandlers?: Record<string, (...args: unknown[]) => void>; position?: unknown }> = [];
  const MapContainer = ({ children, center, zoom }: unknown) => (
    <div data-testid="map-container" data-center={JSON.stringify(center)} data-zoom={zoom}>
      {children}
    </div>
  );
  const TileLayer = () => <div data-testid="tile-layer" />;
  const Marker = ({ children, position, eventHandlers }: unknown) => {
    markerInstances.push({ eventHandlers, position });
    return (
      <div data-testid="marker" data-position={JSON.stringify(position)}>
        {children}
      </div>
    );
  };
  const Popup = ({ children }: unknown) => <div data-testid="popup">{children}</div>;
  const Circle = () => <div data-testid="circle" />;

  return {
    __esModule: true,
    MapContainer,
    TileLayer,
    Marker,
    Popup,
    Circle,
    useMap: () => mapInstance,
    useMapEvents: (handlers: Record<string, (...args: unknown[]) => void>) => {
      mapEventsHandlers.current = handlers;
      return mapInstance;
    },
    __mock: {
      mapInstance,
      mapEventsHandlers,
      markerInstances,
    },
  };
});

const getReactLeafletMocks = () =>
  (jest.requireMock('react-leaflet') as unknown).__mock as {
    mapInstance: {
      flyToBounds: jest.Mock;
      setView: jest.Mock;
      flyTo: jest.Mock;
      getZoom: jest.Mock;
    };
    mapEventsHandlers: { current: Record<string, (...args: unknown[]) => void> | null };
    markerInstances: Array<{ eventHandlers?: Record<string, (...args: unknown[]) => void>; position?: unknown }>;
  };

describe('MapComponent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { mapEventsHandlers, markerInstances } = getReactLeafletMocks();
    mapEventsHandlers.current = null;
    markerInstances.length = 0;
  });

  it('invokes onContactClick when a slot CTA is pressed', async () => {
    const onContactClick = jest.fn();
    const user = userEvent.setup();

    render(
      <MapComponent
        center={[43.4, -1.3]}
        items={[
          {
            id: 'availability-1',
            lat: 43.41,
            lng: -1.31,
            userId: 'user-123',
            displayName: 'Coach Léa',
          },
        ]}
        onContactClick={onContactClick}
      />,
    );

    await user.click(screen.getByRole('button', { name: /contacter/i }));
    expect(onContactClick).toHaveBeenCalledWith('user-123');
  });

  it('toggles legend visibility and closes on escape', async () => {
    const user = userEvent.setup();

    render(
      <MapComponent
        center={[43.4, -1.3]}
        items={[]}
        onContactClick={jest.fn()}
        legend={[{ label: 'Pros', color: '#2563eb' }]}
      />,
    );

    const toggle = screen.getByRole('button', { name: /afficher la légende/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('flies to bounds when items are provided', async () => {
    render(
      <MapComponent
        center={[43.4, -1.3]}
        items={[
          { id: 'availability-1', lat: 43.41, lng: -1.31, userId: 'user-123' },
          { id: 'availability-2', lat: 43.42, lng: -1.32, userId: 'user-456' },
        ]}
        onContactClick={jest.fn()}
        radiusKm={20}
      />,
    );

    await act(async () => {});

    const { mapInstance } = getReactLeafletMocks();
    expect(mapInstance.flyToBounds).toHaveBeenCalled();
  });
});
