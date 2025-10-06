import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../dialog';

describe('Dialog', () => {
  it('does not render content when closed', () => {
    render(
      <Dialog>
        <DialogTrigger>
          <span>Open</span>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByText('Dialog title')).not.toBeInTheDocument();
  });

  it('shows content after trigger click', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>
          <span>Open dialog</span>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog content</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole('button', { name: /open dialog/i }));

    expect(screen.getByText('Dialog content')).toBeInTheDocument();
  });

  it('supports asChild triggers', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <span role="button" tabIndex={0} data-testid="custom-trigger">
            Toggle
          </span>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Content</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByTestId('custom-trigger'));

    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('throws when trigger used outside dialog', () => {
    // Suppress console.error for this test since we expect an error
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      render(
        <DialogTrigger>
          <span>Open</span>
        </DialogTrigger>,
      ),
    ).toThrow('DialogTrigger must be used within Dialog');

    consoleError.mockRestore();
  });
});
