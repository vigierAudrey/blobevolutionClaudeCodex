"use client";

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Badge } from '../ui/badge';

interface RiderMiniature {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  sport?: 'surf' | 'kitesurf' | null;
  level?: 'beginner' | 'intermediate' | 'advanced' | null;
  bio?: string;
}

interface RiderMiniaturesStripProps {
  riders: RiderMiniature[];
}

export function RiderMiniaturesStrip({ riders }: RiderMiniaturesStripProps) {
  const [selected, setSelected] = useState<RiderMiniature | null>(null);
  const visible = riders.slice(0, 4);
  const hiddenCount = riders.length - visible.length;

  return (
    <div className="flex items-center gap-2">
      {visible.map((rider) => (
        <Dialog key={rider.id}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="h-10 w-10 overflow-hidden rounded-full border"
              onClick={() => setSelected(rider)}
            >
              {rider.avatarUrl ? (
                <Image src={rider.avatarUrl} alt={rider.displayName} width={40} height={40} />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-muted text-xs">
                  {rider.displayName.slice(0, 2).toUpperCase()}
                </span>
              )}
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selected?.displayName}</DialogTitle>
            </DialogHeader>
            {selected && (
              <div className="space-y-3 text-sm">
                {(selected.sport || selected.level) && (
                  <Badge variant="secondary">
                    {[selected.sport, selected.level].filter(Boolean).join(' • ')}
                  </Badge>
                )}
                <p className="text-muted-foreground">{selected.bio || 'Pas encore de bio.'}</p>
                <Button variant="outline" onClick={() => setSelected(null)}>
                  Retour aux résultats
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      ))}
      {hiddenCount > 0 && (
        <span className="text-xs text-muted-foreground">+{hiddenCount}</span>
      )}
    </div>
  );
}
