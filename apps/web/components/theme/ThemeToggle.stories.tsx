import type { Meta, StoryObj } from '@storybook/react';
import { ThemeProvider } from './ThemeProvider';
import { ThemeToggle } from './ThemeToggle';

const meta: Meta<typeof ThemeToggle> = {
  title: 'Theme/ThemeToggle',
  component: ThemeToggle,
  tags: ['autodocs'],
  args: {
    floating: false,
    showLabel: true,
  },
  decorators: [
    (Story) => (
      <ThemeProvider>
        <div style={{ padding: 16 }}>
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ThemeToggle>;

export const Default: Story = {};

export const FloatingIconOnly: Story = {
  args: {
    floating: true,
    showLabel: false,
  },
  decorators: [
    (Story) => (
      <ThemeProvider>
        <div style={{ height: 200, position: 'relative', border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
          <div style={{ position: 'absolute', right: 16, bottom: 16 }}>
            <Story />
          </div>
        </div>
      </ThemeProvider>
    ),
  ],
};

