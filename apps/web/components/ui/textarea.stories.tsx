import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from './textarea';

const meta: Meta<typeof Textarea> = {
  title: 'UI/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  args: {
    placeholder: 'Décris ton expérience ou tes attentes…',
  },
  parameters: {
    docs: {
      description: {
        component: 'Zone de texte multi-ligne utilisée pour les messages, briefs de cours ou feedbacks.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof Textarea>;

export const Default: Story = {};

export const WithHelper: Story = {
  render: (args) => (
    <div className="space-y-1">
      <Textarea {...args} rows={5} />
      <p className="text-xs text-muted-foreground">Minimum 30 caractères pour aider le pro à préparer la session.</p>
    </div>
  ),
};
