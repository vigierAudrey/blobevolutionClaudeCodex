"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { apiClient } from '../../lib/apiClient';
import { Wallet, Plus, Minus, Gift, Award, RefreshCw } from 'lucide-react';

type CreditTransaction = {
  id: string;
  type: 'WELCOME_BONUS' | 'ADMIN_GRANT' | 'LESSON_BOOKING' | 'LESSON_REFUND' | 'PROMO_BONUS' | 'REFERRAL_BONUS';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description?: string;
  metadata?: any;
  createdAt: string;
};

type UserWallet = {
  balance: number;
  createdAt: string;
  updatedAt: string;
};

const transactionTypeLabels = {
  WELCOME_BONUS: 'Bonus de bienvenue',
  ADMIN_GRANT: 'Crédit offert',
  LESSON_BOOKING: 'Réservation cours',
  LESSON_REFUND: 'Remboursement cours',
  PROMO_BONUS: 'Bonus promotionnel',
  REFERRAL_BONUS: 'Bonus parrainage'
};

const transactionTypeColors = {
  WELCOME_BONUS: 'text-purple-600 bg-purple-50',
  ADMIN_GRANT: 'text-blue-600 bg-blue-50',
  LESSON_BOOKING: 'text-red-600 bg-red-50',
  LESSON_REFUND: 'text-green-600 bg-green-50',
  PROMO_BONUS: 'text-orange-600 bg-orange-50',
  REFERRAL_BONUS: 'text-pink-600 bg-pink-50'
};

const transactionIcons = {
  WELCOME_BONUS: Gift,
  ADMIN_GRANT: Award,
  LESSON_BOOKING: Minus,
  LESSON_REFUND: Plus,
  PROMO_BONUS: Gift,
  REFERRAL_BONUS: Award
};

export default function CreditsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWelcomeBonus, setShowWelcomeBonus] = useState(false);

  useEffect(() => {
    loadWalletData();
  }, []);

  const loadWalletData = async () => {
    try {
      const tokens = apiClient.getTokens();
      if (!tokens?.accessToken) {
        router.replace('/login');
        return;
      }

      const currentUser = await apiClient.me();
      setUser(currentUser);

      // Rediriger les PRO vers leur dashboard
      if (currentUser.role === 'PRO') {
        router.replace('/pro/dashboard');
        return;
      }

      // Récupérer le wallet et les transactions
      const data = await apiClient.getWallet();
      setWallet(data.wallet);
      setTransactions(data.transactions);

      // Vérifier si l'utilisateur peut réclamer le bonus de bienvenue
      const hasWelcomeBonus = data.transactions.some((t: CreditTransaction) => t.type === 'WELCOME_BONUS');
      setShowWelcomeBonus(!hasWelcomeBonus);

    } catch (err: any) {
      console.error('Erreur lors du chargement:', err);
      setError(err?.message || 'Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  const claimWelcomeBonus = async () => {
    setClaiming(true);
    setError(null);

    try {
      await apiClient.claimWelcomeBonus();

      // Recharger les données
      await loadWalletData();
      setShowWelcomeBonus(false);

    } catch (err: any) {
      setError(err?.message || 'Erreur lors de l\'ajout du bonus');
    } finally {
      setClaiming(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatAmount = (amount: number) => {
    return amount > 0 ? `+${amount}` : `${amount}`;
  };

  if (loading) return <p>Chargement…</p>;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <BackBar fallbackHref="/dashboard" />

      <div>
        <h1 className="text-2xl font-semibold">Mes Crédits</h1>
        <p className="text-sm text-muted-foreground">
          Gérez votre porte-monnaie virtuel Blobinfini.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {/* Bonus de bienvenue */}
      {showWelcomeBonus && (
        <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-800">
              <Gift size={20} />
              Bonus de bienvenue disponible ! 🎉
            </CardTitle>
            <CardDescription className="text-purple-600">
              Bienvenue sur Blobinfini ! Réclamez vos 100 premiers crédits gratuits pour commencer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={claimWelcomeBonus}
              disabled={claiming}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {claiming ? 'Ajout en cours...' : 'Réclamer mes 100 crédits ! 🎁'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Solde actuel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet size={20} />
            Solde actuel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold text-green-600">
                {wallet?.balance || 0} crédits
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Porte-monnaie créé le {wallet && formatDate(wallet.createdAt)}
              </p>
            </div>
            <Button
              onClick={loadWalletData}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              <RefreshCw size={16} />
              Actualiser
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Informations MVP */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-800">Mode MVP - Crédits gratuits</CardTitle>
          <CardDescription className="text-blue-600">
            Pour le moment, nous offrons des crédits virtuels aux premiers utilisateurs de Blobinfini.
            Ces crédits vous permettront de tester toutes les fonctionnalités gratuitement !
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-blue-700">
            <p>• Les crédits sont offerts gratuitement pendant la phase MVP</p>
            <p>• Vous pouvez les utiliser pour réserver des cours avec des pros</p>
            <p>• Plus tard, vous pourrez acheter des crédits avec de l'argent réel</p>
          </div>
        </CardContent>
      </Card>

      {/* Historique des transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Historique des transactions</CardTitle>
          <CardDescription>
            Vos dernières transactions de crédits.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Aucune transaction pour le moment.</p>
              {showWelcomeBonus && (
                <p className="text-sm mt-2">Réclamez votre bonus de bienvenue ci-dessus pour commencer !</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((transaction) => {
                const Icon = transactionIcons[transaction.type];
                const colorClass = transactionTypeColors[transaction.type];
                const isPositive = transaction.amount > 0;

                return (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${colorClass}`}>
                        <Icon size={16} />
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {transactionTypeLabels[transaction.type]}
                        </p>
                        {transaction.description && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {transaction.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {formatDate(transaction.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className={`font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {formatAmount(transaction.amount)} crédits
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Solde: {transaction.balanceAfter} crédits
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}