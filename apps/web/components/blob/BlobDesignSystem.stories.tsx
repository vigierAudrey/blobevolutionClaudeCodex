import type { Meta, StoryObj } from '@storybook/react';
import {
  BlobAlert,
  BlobBadge,
  BlobBrandBadge,
  BlobButton,
  BlobEmptyState,
  BlobFormCard,
  BlobInput,
  BlobLogo,
  BlobPageHeader,
  BlobTabs,
} from './index';

const meta: Meta = {
  title: 'Blob/Design System',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

type Story = StoryObj;

export const Foundation: Story = {
  render: () => (
    <div className="min-h-screen bg-blob-sand p-6 text-blob-black">
      <div className="mx-auto max-w-5xl space-y-8">
        <BlobPageHeader
          title="Design system Blob"
          subtitle="Composants visuels reutilisables pour les prochains lots auth, compte et dashboard."
        />

        <section className="grid gap-4 rounded-sm border-2 border-blob-sand-deep bg-white p-5 md:grid-cols-2">
          <div className="rounded-sm bg-blob-black p-4">
            <BlobLogo variant="light" size="md" />
          </div>
          <div className="rounded-sm bg-blob-sand p-4">
            <BlobLogo variant="dark" size="md" />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <BlobFormCard>
            <BlobInput
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="rider@blob.fr"
              hint="Utilise l'adresse de ton compte Blob."
            />
            <BlobInput
              label="Mot de passe"
              type="password"
              autoComplete="current-password"
              error="Le mot de passe est requis."
            />
            <BlobButton loading>Connexion</BlobButton>
          </BlobFormCard>

          <div className="space-y-3">
            <BlobAlert variant="info" title="Info">
              Ton profil reste modifiable apres inscription.
            </BlobAlert>
            <BlobAlert variant="success">Profil enregistre.</BlobAlert>
            <BlobAlert variant="warning">Verification requise avant publication.</BlobAlert>
            <BlobAlert variant="error">Impossible de traiter la demande.</BlobAlert>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <BlobBadge brandMark>Beta locale</BlobBadge>
            <BlobBadge variant="dark">Pro</BlobBadge>
            <BlobBadge variant="sand">Rider</BlobBadge>
            <BlobBadge variant="success">Actif</BlobBadge>
            <BlobBadge variant="error">Bloque</BlobBadge>
            <BlobBrandBadge>Partenaire Blob</BlobBrandBadge>
          </div>

          <BlobTabs
            items={[
              { label: 'Profil', href: '#profil', active: true },
              { label: 'Messages', href: '#messages' },
              { label: 'Notifications', href: '#notifications' },
              { label: 'Archive', disabled: true },
            ]}
          />
        </section>

        <BlobEmptyState
          title="Aucun message"
          description="Les conversations apparaissent ici quand un contact demarre."
          action={<BlobButton size="sm">Voir les demandes</BlobButton>}
        />
      </div>
    </div>
  ),
};
