/**
 * Maps known server-side English error messages to French user-facing messages.
 * Never surfaces raw server messages to the user — all unmapped messages fall
 * back to a generic neutral string so English leaks don't reach the UI.
 *
 * Variante FR historique conservée pour les écrans pas encore migrés sur
 * next-intl (login-pro…). Les composants traduits utilisent directement
 * `t(`errors.${mapAuthErrorToKey(message)}`)` — même classification, mêmes
 * textes (fr.json est la source de vérité).
 */
import frMessages from '@/messages/fr.json';
import { mapAuthErrorToKey } from './mapAuthErrorToKey';

export function mapAuthErrorToFrench(message: string): string {
  return frMessages.auth.errors[mapAuthErrorToKey(message)];
}
