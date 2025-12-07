import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './input';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  args: {
    placeholder: 'Tape ton spot favori…',
  },
  parameters: {
    docs: {
      description: {
        component: 'Champ de saisie standard utilisé dans les formulaires BlobConnect (auth, matching, réservation…).',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof Input>;

export const Default: Story = {};

export const WithErrorState: Story = {
  render: (args) => (
    <div className="space-y-1">
      <Input {...args} className="border-destructive focus-visible:ring-destructive" value="" />
      <p className="text-xs text-destructive">Merci d’indiquer une adresse e-mail valide.</p>
    </div>
  ),
  args: {
    placeholder: 'adresse@email.com',
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    value: 'Mode lecture seule',
  },
};
