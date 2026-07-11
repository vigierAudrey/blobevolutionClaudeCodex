/*
 * Wrapper minimal autour de window.location.reload.
 * jsdom ne permet pas de stubber location.reload directement : ce module
 * donne un point de mock propre aux tests (jest.mock('@/lib/hardReload')).
 */
export function hardReload(): void {
  window.location.reload();
}
