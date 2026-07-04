/**
 * Tests unitaires — canViewUserPhoto (media.service.ts)
 *
 * Politique : la photo rider est visible par tout RIDER authentifié
 * (cartes matching, modale de match, conversations) — c'est le contrat
 * produit ("Visible dans le matching", photo obligatoire à l'onboarding).
 *
 * Couvre :
 *  - RIDER self → true
 *  - RIDER demandant la photo d'un autre user → true
 *  - PRO self / PRO vers autre → false
 *  - ADMIN self / ADMIN vers autre → false
 *  - utilisateur introuvable en DB → false
 *  - erreur DB → propagée (le controller retourne 500)
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../../utils/secure-logger', () => ({
  secureLogger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { clientPrisma as prisma } from '@blobinfini/database';
import { canViewUserPhoto } from '../media.service';

const mockFindUnique = prisma.user.findUnique as jest.MockedFunction<
  typeof prisma.user.findUnique
>;

const USER_A = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const USER_B = '00000000-0000-0000-0000-bbbbbbbbbbbb';

describe('canViewUserPhoto', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
  });

  it('renvoie true pour un RIDER demandant sa propre photo', async () => {
    mockFindUnique.mockResolvedValue({ role: 'RIDER' } as never);
    expect(await canViewUserPhoto(USER_A, USER_A)).toBe(true);
  });

  it('renvoie true pour un RIDER demandant la photo d’un autre utilisateur', async () => {
    mockFindUnique.mockResolvedValue({ role: 'RIDER' } as never);
    expect(await canViewUserPhoto(USER_A, USER_B)).toBe(true);
    // L'autorisation est décidée sur le rôle du demandeur, jamais sur la cible
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: USER_A },
      select: { role: true },
    });
  });

  it('renvoie false pour un PRO demandant sa propre photo', async () => {
    mockFindUnique.mockResolvedValue({ role: 'PRO' } as never);
    expect(await canViewUserPhoto(USER_A, USER_A)).toBe(false);
  });

  it('renvoie false pour un PRO demandant la photo d’un autre utilisateur', async () => {
    mockFindUnique.mockResolvedValue({ role: 'PRO' } as never);
    expect(await canViewUserPhoto(USER_A, USER_B)).toBe(false);
  });

  it('renvoie false pour un ADMIN demandant sa propre photo', async () => {
    mockFindUnique.mockResolvedValue({ role: 'ADMIN' } as never);
    expect(await canViewUserPhoto(USER_A, USER_A)).toBe(false);
  });

  it('renvoie false pour un ADMIN demandant la photo d’un autre utilisateur', async () => {
    mockFindUnique.mockResolvedValue({ role: 'ADMIN' } as never);
    expect(await canViewUserPhoto(USER_A, USER_B)).toBe(false);
  });

  it('renvoie false si utilisateur introuvable en DB', async () => {
    mockFindUnique.mockResolvedValue(null as never);
    expect(await canViewUserPhoto(USER_A, USER_A)).toBe(false);
  });

  it('propage une erreur DB (le controller gère le 500)', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB connection lost') as never);
    await expect(canViewUserPhoto(USER_A, USER_A)).rejects.toThrow('DB connection lost');
  });
});
