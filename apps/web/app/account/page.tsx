"use client";
import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { useRouter } from 'next/navigation';

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const t = apiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      return;
    }
    apiClient
      .me()
      .then(setUser)
      .catch((e) => setError(e?.message || 'Erreur'))
      .finally(() => setLoading(false));
  }, [router]);

  const logout = async () => {
    try {
      await apiClient.logoutAll();
    } catch (_) {}
    apiClient.clearTokens();
    router.replace('/login');
  };

  const resend = async () => {
    if (!user?.email) return;
    setInfo(null);
    try {
      await apiClient.resendVerification(user.email);
      setInfo('Email de vérification renvoyé. Vérifie ta boîte mail.');
    } catch (e: any) {
      setError(e?.message || 'Erreur lors de l’envoi');
    }
  };

  if (loading) return <p>Chargement…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="max-w-md mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Mon compte</h1>
      <div className="bg-white shadow-sm rounded-lg p-4 sm:p-6">
        <div className="space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Email</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Rôle</span>
            <span className="font-medium">{user?.role}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Email vérifié</span>
            <span className={`font-medium ${user?.emailVerified ? 'text-green-600' : 'text-yellow-700'}`}>
              {user?.emailVerified ? 'Oui' : 'Non'}
            </span>
          </div>
        </div>

        {!user?.emailVerified && (
          <div className="mt-4">
            <button
              onClick={resend}
              className="w-full inline-flex items-center justify-center rounded-md border border-gray-300 px-4 py-2"
            >
              Renvoyer l’email de vérification
            </button>
          </div>
        )}

        {info && <p className="text-sm text-green-600 mt-3">{info}</p>}
      </div>

      <button
        onClick={logout}
        className="w-full inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-white"
      >
        Se déconnecter
      </button>
    </div>
  );
}

