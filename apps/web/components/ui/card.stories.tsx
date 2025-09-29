import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { Button } from './button';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'Conteneur polyvalent pour regrouper des informations avec en-tête, contenu et actions.',
      },
    },
  },
  args: {
    className: 'max-w-md',
  },
};

export default meta;

type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Planifier un cours</CardTitle>
        <CardDescription>Définis le sport, la date et le créneau souhaité.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-sm font-medium">Discipline</p>
          <p className="text-sm text-muted-foreground">Surf intermédiaire</p>
        </div>
        <div>
          <p className="text-sm font-medium">Créneau</p>
          <p className="text-sm text-muted-foreground">Samedi 9h00 - 11h00</p>
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="ghost" size="sm">
          Annuler
        </Button>
        <Button size="sm">Confirmer</Button>
      </CardFooter>
    </Card>
  ),
};

export const WithAccent: Story = {
  args: {
    className: 'max-w-md border-blue-200 bg-blue-50',
  },
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Blobosphère</CardTitle>
        <CardDescription>Mets en avant tes meilleurs spots auprès de la communauté.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-blue-800">
          Publie un article et ajoute des photos pour inspirer les riders qui visitent la côte.
        </p>
      </CardContent>
    </Card>
  ),
};
