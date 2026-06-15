import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { AdminStepUpDialog } from './AdminStepUpDialog';
import { Button } from '../ui/button';

const meta: Meta<typeof AdminStepUpDialog> = {
  title: 'Admin/AdminStepUpDialog',
  component: AdminStepUpDialog,
};

export default meta;

type Story = StoryObj<typeof AdminStepUpDialog>;

function AdminStepUpDialogDemo() {
  const [open, setOpen] = useState(true);

  return (
    <div className="min-h-64 p-4">
      <Button onClick={() => setOpen(true)}>Ouvrir confirmation</Button>
      <AdminStepUpDialog
        open={open}
        onOpenChange={setOpen}
        onConfirmed={async () => undefined}
        requestStepUp={async () => ({ message: 'Code de confirmation envoyé.' })}
        verifyStepUp={async () => ({ message: 'Admin step-up granted', stepUpUntil: Date.now() + 300000 })}
      />
    </div>
  );
}

export const Open: Story = {
  render: () => <AdminStepUpDialogDemo />,
};
