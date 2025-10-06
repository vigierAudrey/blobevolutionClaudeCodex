import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Button } from '../button';

describe('Button', () => {
  it('applies default styling', () => {
    render(<Button>Click me</Button>);

    const button = screen.getByRole('button', { name: /click me/i });
    expect(button).toHaveClass('bg-primary');
    expect(button).toHaveClass('h-10');
  });

  it('supports variant and size overrides', () => {
    render(
      <Button variant="secondary" size="sm">
        Secondary
      </Button>,
    );

    const button = screen.getByRole('button', { name: /secondary/i });
    expect(button).toHaveClass('bg-secondary');
    expect(button).toHaveClass('h-9');
  });

  it('prevents click handler execution when disabled', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );

    await user.click(screen.getByRole('button', { name: /disabled/i }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('can render as child element', () => {
    render(
      <Button asChild>
        <a href="/docs" data-testid="button-child">
          Docs
        </a>
      </Button>,
    );

    const child = screen.getByTestId('button-child');
    expect(child.tagName).toBe('A');
    expect(child).toHaveAttribute('href', '/docs');
    expect(child).toHaveClass('inline-flex');
  });
});
