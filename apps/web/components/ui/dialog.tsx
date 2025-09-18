"use client";

import * as React from 'react';

interface DialogProps {
  children: React.ReactNode;
}

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue | undefined>(undefined);

export function Dialog({ children }: DialogProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <DialogContext.Provider value={{ open, setOpen }}>
      {children}
    </DialogContext.Provider>
  );
}

export function DialogTrigger({ asChild, children }: { asChild?: boolean; children: React.ReactElement }) {
  const context = React.useContext(DialogContext);
  if (!context) throw new Error('DialogTrigger must be used within Dialog');

  const trigger = React.cloneElement(children, {
    onClick: () => context.setOpen(true),
  });

  return asChild ? trigger : <button onClick={() => context.setOpen(true)}>{children}</button>;
}

export function DialogContent({ children }: DialogProps) {
  const context = React.useContext(DialogContext);
  if (!context || !context.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ children }: DialogProps) {
  return <div className="mb-4 space-y-1">{children}</div>;
}

export function DialogTitle({ children }: DialogProps) {
  return <h2 className="text-lg font-semibold">{children}</h2>;
}
