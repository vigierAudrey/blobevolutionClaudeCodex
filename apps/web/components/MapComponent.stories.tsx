import type { Meta, StoryObj } from '@storybook/react';
import { action } from '@storybook/addon-actions';
import MapComponent from './MapComponent';

const meta: Meta<typeof MapComponent> = {
  title: 'Components/MapComponent',
  component: MapComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Carte OpenStreetMap basée sur React-Leaflet utilisée pour visualiser les disponibilités et riders à proximité. La story installe automatiquement le CSS Leaflet et illustre l’affichage des marqueurs et du rayon.',
      },
    },
  },
  args: {
    center: [43.488, -1.556],
    radiusKm: 25,
    legend: [
      { label: 'Disponibilités', color: '#2563eb' },
      { label: 'Riders', color: '#16a34a' },
    ],
    onContactClick: action('contact-click'),
    items: [
      {
        id: 'availability-a',
        userId: 'pro-1',
        lat: 43.49,
        lng: -1.52,
        displayName: 'Cours de surf Hossegor',
        distanceKm: 4.2,
        type: 'availability',
      },
      {
        id: 'rider-1',
        userId: 'rider-1',
        lat: 43.46,
        lng: -1.58,
        displayName: 'Camille',
        distanceKm: 3.1,
        type: 'rider',
      },
      {
        id: 'rider-2',
        userId: 'rider-2',
        lat: 43.50,
        lng: -1.60,
        displayName: 'Mathis',
        distanceKm: 6.5,
        type: 'default',
      },
    ],
  },
};

export default meta;

type Story = StoryObj<typeof MapComponent>;

export const Default: Story = {
  render: (args) => {
    if (typeof window === 'undefined') {
      return (
        <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Chargement de la carte…
        </div>
      );
    }
    return <MapComponent {...args} />;
  },
};

export const WithCenterMarker: Story = {
  args: {
    centerMarker: {
      label: 'Ta position',
      description: 'Point de recherche (Biarritz)',
    },
    showCenterMarker: true,
  },
  render: Default.render,
};
