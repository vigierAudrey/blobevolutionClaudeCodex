import { act, render, screen } from '@testing-library/react';
import React from 'react';
import LocationPickerMap from '../LocationPickerMap';

jest.mock('leaflet', () => {
  class FakeIconDefault {
    static mergeOptions = jest.fn();

    _getIconUrl = jest.fn();
  }

  class FakeMarker {
    getLatLng() {
      return { lat: 0, lng: 0 };
    }
  }

  const divIcon = jest.fn((options: unknown) => ({ options }));

  const exports = {
    Icon: {
      Default: FakeIconDefault,
    },
    Marker: FakeMarker,
    divIcon,
  };

  return {
    __esModule: true,
    default: exports,
    ...exports,
  };
});

type MapContainerProps = React.PropsWithChildren<{
  center: [number, number];
  zoom: number;
  scrollWheelZoom?: boolean;
}> &
  React.HTMLAttributes<HTMLDivElement>;

type MarkerProps = React.PropsWithChildren<{
  position: [number, number];
  eventHandlers?: Record<string, (...args: unknown[]) => void>;
}> &
  React.HTMLAttributes<HTMLDivElement>;

type ReactLeafletMockState = {
  mapInstance: {
    setView: jest.Mock;
    flyTo: jest.Mock;
    getZoom: jest.Mock;
  };
  mapEventsHandlers: { current: Record<string, (...args: unknown[]) => void> | null };
  markerInstances: Array<{ eventHandlers?: Record<string, (...args: unknown[]) => void>; position?: [number, number] }>;
};

jest.mock('react-leaflet', () => {
  const MapContainer = ({ children, center, zoom, scrollWheelZoom, ...divProps }: MapContainerProps) => {
    return (
      <div
        data-testid="map-container"
        data-center={JSON.stringify(center)}
        data-zoom={zoom}
        data-scroll-wheel-zoom={scrollWheelZoom ?? 'undefined'}
        {...divProps}
      >
        {children}
      </div>
    );
  };
  const TileLayer = (props: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="tile-layer" {...props} />;
  const mapInstance = {
    setView: jest.fn(),
    flyTo: jest.fn(),
    getZoom: jest.fn(() => 13),
  };
  const mapEventsHandlers: { current: Record<string, (...args: unknown[]) => void> | null } = {
    current: null,
  };
  const markerInstances: Array<{ eventHandlers?: Record<string, (...args: unknown[]) => void>; position?: unknown }> = [];
  const Marker = ({ children, position, eventHandlers, ...rest }: MarkerProps) => {
    markerInstances.push({ eventHandlers, position });
    return (
      <div data-testid="marker" data-position={JSON.stringify(position)} {...rest}>
        {children}
      </div>
    );
  };

  return {
    __esModule: true,
    MapContainer,
    TileLayer,
    Marker,
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
  (jest.requireMock('react-leaflet') as { __mock: ReactLeafletMockState }).__mock;

type LeafletMarkerConstructor = new () => {
  getLatLng: () => { lat: number; lng: number };
};

type LeafletMockModule = {
  default?: { Marker?: LeafletMarkerConstructor };
  Marker?: LeafletMarkerConstructor;
};

describe('LocationPickerMap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { mapEventsHandlers, markerInstances } = getReactLeafletMocks();
    mapEventsHandlers.current = null;
    markerInstances.length = 0;
  });

  it('emits coordinates when map is clicked', () => {
    const onChange = jest.fn();

    render(<LocationPickerMap value={null} onChange={onChange} />);

    const { mapEventsHandlers, mapInstance } = getReactLeafletMocks();
    const handlers = mapEventsHandlers.current;
    expect(handlers).toBeTruthy();

    act(() => {
      handlers?.click?.({ latlng: { lat: 43.1234567, lng: -1.9876543 } } as unknown);
    });

    expect(onChange).toHaveBeenCalledWith({ lat: 43.123457, lng: -1.987654 });
    expect(mapInstance.flyTo).toHaveBeenCalledWith([43.123457, -1.987654], 13);
    expect(mapInstance.getZoom).toHaveBeenCalled();
  });

  it('renders marker when value is provided', () => {
    render(<LocationPickerMap value={{ lat: 43.5, lng: -1.5 }} onChange={jest.fn()} />);

    const marker = screen.getByTestId('marker');
    expect(marker).toHaveAttribute('data-position', JSON.stringify([43.5, -1.5]));
    const { mapInstance } = getReactLeafletMocks();
    expect(mapInstance.setView).toHaveBeenCalledWith([43.5, -1.5]);
  });

  it('propagates drag updates when marker is draggable', () => {
    const onChange = jest.fn();

    render(
      <LocationPickerMap
        value={{ lat: 43.5, lng: -1.5 }}
        onChange={onChange}
        draggableMarker
      />,
    );

    const { markerInstances } = getReactLeafletMocks();
    const instance = markerInstances[0];
    expect(instance).toBeDefined();

    act(() => {
      const leafletModule = jest.requireMock('leaflet') as LeafletMockModule;
      const MarkerClass = leafletModule.default?.Marker || leafletModule.Marker;
      expect(MarkerClass).toBeDefined();
      if (!MarkerClass) {
        throw new Error('Leaflet marker mock is missing');
      }
      const target = new MarkerClass();
      target.getLatLng = () => ({ lat: 44.1234567, lng: -1.6543219 });
      instance?.eventHandlers?.dragend?.({ target } as unknown);
    });

    expect(onChange).toHaveBeenCalledWith({ lat: 44.123457, lng: -1.654322 });
  });
});
