'use client';
import { CheckCircle2, Circle } from 'lucide-react';
import type { PasswordRequirementStatus } from '../../api/src/utils/password-validator';

interface PasswordRequirementsListProps {
  statuses: PasswordRequirementStatus[];
}

export function PasswordRequirementsList({ statuses }: PasswordRequirementsListProps) {
  return (
    <div className="rounded-sm border-2 border-blob-sand-deep bg-white p-3 text-sm text-blob-black">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-blob-black/60">
        Ton mot de passe doit inclure :
      </p>
      <ul className="mt-2 space-y-1">
        {statuses.map((status) => (
          <li
            key={status.id}
            className={`flex items-center gap-2 ${status.satisfied ? 'text-green-800' : 'text-blob-black/58'}`}
          >
            {status.satisfied ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Circle className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{status.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
