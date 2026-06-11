// L'éditeur Decap interne est désactivé en production (cf.
// app/admin/blobosphere/page.tsx) : ce proxy OAuth ne doit pas rester
// exposé sans lui.
// Module séparé de route.ts : Next.js n'autorise que les handlers HTTP et
// les champs de config en export d'un fichier route.
export function isDecapAuthProxyEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}
