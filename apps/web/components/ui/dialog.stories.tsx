import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from './dialog';

const meta: Meta<typeof Dialog> = {
  title: 'UI/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Boîte de dialogue légère contrôlée par contexte, idéale pour confirmer une action ou afficher un formulaire court.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof Dialog>;

function DialogExample() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Ouvrir la modale</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmer la session</DialogTitle>
          <DialogDescription>Valide avec ton rider le créneau proposé.</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Samedi 14h00 – Hossegor. Si le créneau te convient, confirme-le pour débloquer la conversation.
        </p>
        <DialogFooter>
          <DialogClose className="rounded-md border px-3 py-2 text-sm">Annuler</DialogClose>
          <DialogClose className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700">
            Confirmer
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const Default: Story = {
  render: () => <DialogExample />,
};
