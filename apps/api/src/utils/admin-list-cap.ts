/**
 * admin-list-cap.ts
 *
 * Clampeur de limite pour les endpoints admin de type "list".
 *
 * Règles :
 * - undefined / null → default 50
 * - NaN / Infinity / négatif → default 50 (fail-safe, pas la valeur min)
 * - Float → tronqué vers l'entier inférieur (Math.trunc), puis clampé
 * - Résultat final : [1, 100]
 *
 * Justification du fallback vers 50 (pas 1) sur valeur invalide :
 * Retourner 1 sur input malformé serait surprenant pour les appels légitimes
 * et ne réduit pas le risque d'abus (un attaquant peut envoyer 100).
 * Le fallback vers default offre un comportement prévisible et documenté.
 */

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

/**
 * Retourne une limite entière dans [1, 100].
 * Toute valeur non finie ou négative retourne le défaut (50).
 */
export function capAdminLimit(input?: unknown): number {
  if (input === undefined || input === null) {
    return DEFAULT_LIMIT;
  }
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(n), MIN_LIMIT), MAX_LIMIT);
}
