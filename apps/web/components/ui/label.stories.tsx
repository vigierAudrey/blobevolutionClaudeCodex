import type { Meta, StoryObj } from '@storybook/react';
import { Label } from './label';
import { Input } from './input';

const meta: Meta<typeof Label> = {
  title: 'UI/Label',
  component: Label,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'Label accessible synchronisé avec les champs de formulaire (Input, Textarea, Select).',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof Label>;

export const Default: Story = {
  render: () => (
    <div className="space-y-2">
      <Label htmlFor="level">Niveau recherché</Label>
      <Input id="level" placeholder="Débutant, Intermédiaire…" />
    </div>
  ),
};

export const WithDescription: Story = {
  render: () => (
    <div className="space-y-2">
      <div>
        <Label htmlFor="bio">Parle-nous de ta pratique</Label>
        <p className="text-xs text-muted-foreground">Ce texte s’affiche sous le label pour guider l’utilisateur.</p>
      </div>
      <textarea
        id="bio"
        className="h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    </div>
  ),
};
