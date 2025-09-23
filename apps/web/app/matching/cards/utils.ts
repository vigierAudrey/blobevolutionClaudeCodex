/**
 * Utilitaires pour les cartes de matching
 */

/**
 * Formate une date pour l'affichage dans les cartes de profil
 */
export function formatDateForDisplay(dateStr: string | null): string {
  if (!dateStr) return '—';
  if (dateStr === 'anytime') return 'Peu importe';

  const today = new Date();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const todayISO = today.toISOString().slice(0, 10);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);

  if (dateStr === todayISO) return "Aujourd'hui";
  if (dateStr === tomorrowISO) return 'Demain';

  try {
    const date = new Date(dateStr + 'T00:00:00');
    if (isNaN(date.getTime())) {
      return dateStr;
    }
    return date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch {
    return dateStr;
  }
}