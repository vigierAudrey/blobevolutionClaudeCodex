import type { Meta, StoryObj } from '@storybook/react';
import {
  Skeleton,
  CardSkeleton,
  ProfileCardSkeleton,
  ListItemSkeleton,
  TableSkeleton,
  MapSkeleton,
} from './skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'UI/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Kit de squelettes (shimmer) utilisé pour les pages dashboard, matching et cartes pendant le chargement des données.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof Skeleton>;

export const BuildingBlocks: Story = {
  render: () => (
    <div className="space-y-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  ),
};

export const Cards: Story = {
  render: () => (
    <div className="grid gap-6 md:grid-cols-2">
      <CardSkeleton />
      <ProfileCardSkeleton />
    </div>
  ),
};

export const ListsAndMap: Story = {
  render: () => (
    <div className="space-y-6">
      <ListItemSkeleton />
      <TableSkeleton rows={3} />
      <MapSkeleton />
    </div>
  ),
};
