'use client';
import { CheckCircle2, Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { PasswordRequirementStatus } from '../../api/src/utils/password-validator';

interface PasswordRequirementsListProps {
  statuses: PasswordRequirementStatus[];
}

export function PasswordRequirementsList({ statuses }: PasswordRequirementsListProps) {
  // Les libellés viennent des clés auth.form.passwordRules.<id> — le label FR
  // renvoyé par l'API (password-validator) n'est pas affiché.
  const t = useTranslations('auth.form');

  return (
    <div className="rounded-sm border-2 border-blob-sand-deep dark:border-white/10 bg-white dark:bg-[hsl(220_14%_14%)] p-3 text-sm text-blob-black dark:text-white">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-blob-black/60 dark:text-white/55">
        {t('passwordRulesTitle')}
      </p>
      <ul className="mt-2 space-y-1">
        {statuses.map((status) => (
          <li
            key={status.id}
            className={`flex items-center gap-2 ${status.satisfied ? 'text-green-800 dark:text-green-400' : 'text-blob-black/58 dark:text-white/55'}`}
          >
            {status.satisfied ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Circle className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{t(`passwordRules.${status.id}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
