import type { Meta, StoryObj } from '@storybook/react';
import { ToastProvider, useToast } from './toast';
import { Button } from './button';

const meta: Meta = {
  title: 'UI/Toast',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Système de notifications non intrusives (toast) affichées en bas de l’écran pour informer l’utilisateur.',
      },
    },
  },
};

export default meta;

type Story = StoryObj;

function ToastPlayground() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast('Session confirmée 👍', 'success')}>Succès</Button>
      <Button onClick={() => toast('Le rider a décliné la session 😕', 'error')} variant="outline">
        Erreur
      </Button>
      <Button onClick={() => toast('Rappel envoyé à ton pro', 'info')} variant="ghost">
        Info
      </Button>
    </div>
  );
}

export const Playground: Story = {
  render: () => (
    <ToastProvider>
      <ToastPlayground />
    </ToastProvider>
  ),
};
