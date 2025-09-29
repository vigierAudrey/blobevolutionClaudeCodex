import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Slider } from './slider';

const meta: Meta<typeof Slider> = {
  title: 'UI/Slider',
  component: Slider,
  tags: ['autodocs'],
  args: {
    min: 0,
    max: 50,
    step: 5,
    defaultValue: [20],
  },
  parameters: {
    docs: {
      description: {
        component: 'Slider natif stylisé utilisé pour sélectionner un rayon de recherche ou une valeur numérique.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof Slider>;

export const Default: Story = {
  render: (args) => {
    const [value, setValue] = useState(args.defaultValue);
    return (
      <div className="space-y-2">
        <Slider {...args} defaultValue={value} onValueChange={setValue} />
        <p className="text-sm text-muted-foreground">Rayon actuel : {value?.[0]} km</p>
      </div>
    );
  },
};
