import type { Meta, StoryObj } from '@storybook/react';
import { PasswordRequirementsList } from './PasswordRequirementsList';
import { getPasswordRequirementStatuses } from '../../api/src/utils/password-validator';

const meta: Meta<typeof PasswordRequirementsList> = {
  title: 'Auth/PasswordRequirementsList',
  component: PasswordRequirementsList,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Checklist interactive qui reflète en temps réel les règles OWASP appliquées par l’API. Utile pour vérifier l’état de chacun des critères pendant la saisie du mot de passe.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof PasswordRequirementsList>;

export const Vide: Story = {
  name: 'Vide (aucun critère respecté)',
  args: {
    statuses: getPasswordRequirementStatuses(''),
  },
};

export const PresqueBon: Story = {
  name: 'Presque valide',
  args: {
    statuses: getPasswordRequirementStatuses('BlobConnect1'),
  },
};

export const Solide: Story = {
  name: 'Mot de passe robuste',
  args: {
    statuses: getPasswordRequirementStatuses('BlobC0nnect42'),
  },
};
