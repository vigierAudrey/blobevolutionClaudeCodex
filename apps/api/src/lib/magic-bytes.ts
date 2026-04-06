/**
 * Magic bytes validation — JPEG, PNG, WebP.
 *
 * Valide les 12 premiers octets réels d'un fichier pour détecter son type binaire.
 * Ne se fie PAS au Content-Type HTTP déclaré par le client.
 *
 * LIMITE DOCUMENTÉE :
 *   Un fichier polyglot qui commence par des magic bytes valides (ex : FF D8 FF)
 *   ET contient un payload arbitraire au-delà de l'octet 12 passera ce check.
 *   En pratique, l'impact est nul sur ce service : MinIO sert le contenu brut,
 *   nginx répond avec X-Content-Type-Options: nosniff + Cache-Control: private,
 *   et le payload ne peut pas s'exécuter côté client via une balise <img>.
 *   Fermeture complète des polyglots nécessiterait un décodage complet (sharp).
 *
 * SVG interdit explicitement :
 *   SVG commence toujours par du texte XML — ne matche aucune signature binaire ci-dessous.
 */

export type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Retourne le MIME type réel d'après les 12 premiers octets, ou null si non reconnu.
 * Exige au minimum 12 octets (signature WebP la plus longue).
 */
export function detectMagicBytes(buf: Buffer): AllowedMime | null {
  if (buf.length < 12) return null;

  // JPEG : FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return 'image/jpeg';
  }

  // PNG : 89 50 4E 47 0D 0A 1A 0A (8 octets)
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
    buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A
  ) {
    return 'image/png';
  }

  // WebP : RIFF (pos 0-3) + WEBP (pos 8-11)
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}
