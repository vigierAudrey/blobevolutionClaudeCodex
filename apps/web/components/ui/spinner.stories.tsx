import type { Meta, StoryObj } from '@storybook/react';
import { Spinner } from './spinner';

const meta: Meta<typeof Spinner> = {
  title: 'UI/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'Icône animée affichée pendant le chargement des actions critiques (réservation, push, matching).',
      },
    },
  },
  args: {
    className: 'h-6 w-6 text-blue-600',
  },
};

export default meta;

type Story = StoryObj<typeof Spinner>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-muted-foreground">
      <Spinner className="h-4 w-4" />
      <Spinner className="h-6 w-6 text-blue-600" />
      <Spinner className="h-8 w-8 text-green-500" />
    </div>
  ),
};
