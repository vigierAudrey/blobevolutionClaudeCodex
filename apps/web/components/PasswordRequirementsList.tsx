'use client';
import { CheckCircle2, Circle } from 'lucide-react';
import type { PasswordRequirementStatus } from '../../api/src/utils/password-validator';

interface PasswordRequirementsListProps {
  statuses: PasswordRequirementStatus[];
}

export function PasswordRequirementsList({ statuses }: PasswordRequirementsListProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Ton mot de passe doit inclure :
      </p>
      <ul className="mt-2 space-y-1">
        {statuses.map((status) => (
          <li
            key={status.id}
            className={`flex items-center gap-2 ${status.satisfied ? 'text-emerald-600' : 'text-slate-500 dark:text-slate-400'}`}
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
