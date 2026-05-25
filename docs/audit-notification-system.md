# Audit du système de notifications - 2025-12-30

## 🔍 État actuel : Analyse complète

### ❌ Problèmes identifiés

#### 1. **Case "emailNotif" NON FONCTIONNELLE**
- **Riders** : `RiderProfile.emailNotif` existe (ligne 164 dans schema.prisma)
- **PROs** : `ProProfile.emailNotif` existe (ligne 164 dans schema.prisma)
- **Problème** : Cette valeur est **lue** mais **jamais utilisée**
  - `matching.controller.ts:95` : `emailNotif: profile.emailNotif` est assigné mais pas exploité
  - Aucun code n'envoie d'email basé sur cette préférence
  - La case à cocher dans le profil ne fait RIEN

#### 2. **Notifications MESSAGES : Incomplètes**
**Ce qui existe** :
- ✅ Socket.io temps réel (`socket.ts:190-198`) : Quand un message est envoyé
- ✅ Service push (`push-notification.service.ts:224-246`) : Fonction `sendNewMessage()` existe

**Ce qui manque** :
- ❌ **Pas de déclenchement** : Quand un message est créé, AUCUNE push notification n'est envoyée
- ❌ Socket.io envoie seulement aux users connectés, les users offline ne reçoivent RIEN
- **Emplacement problème** :
  - `socket.ts:160-181` : Création message → Seulement Socket.io
  - `conversations.controller.ts:285` : Création message REST → Pas de notification

#### 3. **Notifications MATCHINGS : Socket.io uniquement**
**Ce qui existe** :
- ✅ Socket.io (`socket.ts:263-273`) : Fonction `notifyNewMatch()`
- ✅ Déclenchement (`matching.controller.ts:435, 446`) : Appelé lors d'un match mutuel

**Ce qui manque** :
- ❌ **Pas de push notification** : Seulement Socket.io, pas de Firebase push
- ❌ Si un rider est hors ligne au moment du match, il ne voit RIEN
- ❌ Pas de préférences (le rider reçoit TOUS les matchs sans pouvoir filtrer)

#### 4. **Notifications INVITATIONS GROUPE : Rien**
**Ce qui existe** :
- ✅ Invitation créée (`conversations.controller.ts:693-745`)
- ✅ Message système dans la conversation
- ✅ Endpoint `/invitations/pending` pour lister les invitations

**Ce qui manque** :
- ❌ **Aucune notification push** quand quelqu'un t'invite dans un groupe
- ❌ **Aucune notification Socket.io** en temps réel
- ❌ L'utilisateur doit manuellement aller dans l'app et check les invitations
- ❌ Pas de compteur/badge pour voir combien d'invitations en attente

#### 5. **Pas de centralisation des préférences**
**Pour les RIDERS** :
- `RiderProfile.emailNotif` : Case à cocher inutilisée
- Aucune interface pour gérer les notifications push
- Aucun contrôle sur les types de notifications (matchs, messages, invitations)

**Pour les PROs** :
- `ProProfile.emailNotif` : Case à cocher inutilisée
- ✅ **NOUVEAU** : `/pro/settings/notifications` pour les demandes de cours (implémenté 2025-12-30)
- ❌ Pas d'options pour messages, mises en relation ouvertes / demandes non retenues

### ✅ Ce qui fonctionne

| Notification | Socket.io temps réel | Push Firebase | Email | Préférences |
|--------------|---------------------|---------------|-------|-------------|
| **Demandes de cours PRO** | ✅ | ✅ | ❌ | ✅ (nouveau) |
| **Mise en relation ouverte** | ❌ | ✅ | ❌ | ❌ |
| **Demande non retenue** | ❌ | ✅ | ❌ | ❌ |
| **Messages** | ✅ | ❌ | ❌ | ❌ |
| **Matchings** | ✅ | ❌ | ❌ | ❌ |
| **Invitations groupe** | ❌ | ❌ | ❌ | ❌ |
| **Rappel de cours** | ❌ | ✅ | ❌ | ❌ |
| **Test notification** | ❌ | ✅ | ❌ | ❌ |

## 📋 Plan d'action recommandé

### Phase 1 : Compléter les notifications manquantes (Critique)

#### 1.1 Messages
```typescript
// Dans socket.ts ou conversations.controller.ts
async function handleNewMessage(conversationId, senderId, content) {
  // ... créer le message

  // Obtenir tous les membres sauf l'expéditeur
  const members = await prisma.conversationMember.findMany({
    where: { conversationId, userId: { not: senderId } },
    include: { user: { select: { id: true, role: true } } }
  });

  // Pour chaque membre
  for (const member of members) {
    // Vérifier les préférences (nouveau)
    const prefs = await getNotificationPreferences(member.userId);
    if (!prefs.messages) continue; // Skip si désactivé

    // Socket.io (déjà fait)
    io.to(`conversation:${conversationId}`).emit('new-message', ...);

    // Push notification (nouveau)
    await pushNotificationService.sendNewMessage(member.userId, {
      senderName,
      message: content,
      conversationId
    });
  }
}
```

#### 1.2 Matchings
```typescript
// Dans matching.controller.ts
if (reciprocal?.decision === 'ACCEPT') {
  // ... créer match et conversation

  // Notifications Socket.io (déjà fait)
  notifyNewMatch(targetProfile.userId, { ... });
  notifyNewMatch(userId, { ... });

  // Notifications Push (nouveau)
  await pushNotificationService.sendNewMatch(targetProfile.userId, {
    matchedUserName: myProfile.displayName,
    conversationId: conv.id
  });

  await pushNotificationService.sendNewMatch(userId, {
    matchedUserName: targetProfile.displayName,
    conversationId: conv.id
  });
}
```

#### 1.3 Invitations groupe
```typescript
// Dans conversations.controller.ts POST /:id/members
await tx.conversationInvitation.create({ ... });

// Nouvelle notification
await pushNotificationService.sendGroupInvitation(body.userId, {
  inviterName,
  conversationId: id,
  memberCount
});

// Socket.io temps réel
notifyUser(body.userId, 'group-invitation', {
  invitationId: invitation.id,
  conversationId: id,
  inviterName,
  memberCount
});
```

### Phase 2 : Centraliser les préférences (Important)

#### 2.1 Nouveau schéma de préférences unifié
```prisma
model NotificationPreferences {
  id        String   @id @default(uuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id])

  // Push notifications
  pushEnabled Boolean @default(true)

  // Préférences par type (Riders)
  notifyMessages    Boolean @default(true)
  notifyMatches     Boolean @default(true)
  notifyInvitations Boolean @default(true)

  // Préférences par type (PROs)
  notifyLessonRequests  Boolean @default(true)
  notifyBookingAccepted Boolean @default(true)
  notifyBookingRejected Boolean @default(true)
  notifyProMessages     Boolean @default(true)

  // Préférences par sport (PROs)
  notifyForSurf     Boolean @default(true)
  notifyForKitesurf Boolean @default(true)

  // Email (future)
  emailEnabled Boolean @default(false)
  emailDigestFrequency String @default('DAILY') // NEVER, DAILY, WEEKLY

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}
```

#### 2.2 Interface unifiée pour tous
- **Route** : `/settings/notifications` (pour riders ET pros)
- **Sections** :
  1. **Général** : Toggle master push, email
  2. **Messagerie** : Messages, invitations
  3. **Matching** : Nouveaux matchs (riders uniquement)
  4. **Réservations** : Demandes de cours, acceptations, refus (pros uniquement)
  5. **Par sport** : Surf, Kitesurf (pros uniquement)

### Phase 3 : Migrer `emailNotif` (Nettoyage)

#### 3.1 Déprécier les anciennes colonnes
```typescript
// Migration
UPDATE "NotificationPreferences" np
SET "emailEnabled" = (
  SELECT "emailNotif"
  FROM "RiderProfile" rp
  WHERE rp."userId" = np."userId"
)
WHERE EXISTS (SELECT 1 FROM "RiderProfile" WHERE "userId" = np."userId");

UPDATE "NotificationPreferences" np
SET "emailEnabled" = (
  SELECT "emailNotif"
  FROM "ProProfile" pp
  WHERE pp."userId" = np."userId"
)
WHERE EXISTS (SELECT 1 FROM "ProProfile" WHERE "userId" = np."userId");

-- Supprimer les anciennes colonnes
ALTER TABLE "RiderProfile" DROP COLUMN "emailNotif";
ALTER TABLE "ProProfile" DROP COLUMN "emailNotif";
```

#### 3.2 Supprimer les anciennes cases à cocher
- Supprimer de `/rider/profile/page.tsx`
- Supprimer de `/pro/profile/page.tsx`
- Rediriger vers `/settings/notifications`

### Phase 4 : Système de throttling généralisé (Optimisation)

#### 4.1 Règles de throttling par type
```typescript
const THROTTLE_RULES = {
  'lesson-request': { window: 300, max: 1 },  // 5 min (déjà fait)
  'message': { window: 60, max: 3 },           // 1 min, max 3 messages
  'match': { window: 0, max: Infinity },       // Pas de throttle (important)
  'group-invitation': { window: 300, max: 2 }, // 5 min, max 2 invitations
  'booking-accepted': { window: 0, max: Infinity },
  'booking-rejected': { window: 0, max: Infinity },
};

async function shouldThrottle(userId: string, notifType: string): Promise<boolean> {
  const rule = THROTTLE_RULES[notifType];
  if (rule.window === 0) return false; // Pas de throttle

  const key = `throttle:${userId}:${notifType}`;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, rule.window);
  }

  return count > rule.max;
}
```

## 📊 Estimation du travail

| Phase | Tâches | Lignes code | Temps estimé | Priorité |
|-------|--------|-------------|--------------|----------|
| **Phase 1** | Notifications messages, matchs, invitations | ~200 | 2-3h | 🔴 Critique |
| **Phase 2** | UI préférences centralisée | ~400 | 3-4h | 🟠 Important |
| **Phase 3** | Migration emailNotif | ~100 | 1h | 🟡 Moyen |
| **Phase 4** | Throttling généralisé | ~150 | 1-2h | 🟢 Bonus |
| **Total** | | ~850 lignes | 7-10h | |

## 🎯 Priorités immédiates

### À faire maintenant (Critique)
1. ✅ **Push notifications messages** : Quand quelqu'un t'envoie un message
2. ✅ **Push notifications matchings** : Quand tu as un nouveau match
3. ✅ **Notifications invitations groupe** : Quand on t'invite dans un groupe

### À faire rapidement (Important)
4. **Interface préférences rider** : Page `/settings/notifications` pour riders
5. **Migrer ProProfile.notificationPreferences** vers table dédiée
6. **Étendre préférences PRO** : Ajouter messages, mises en relation ouvertes / demandes non retenues

### À faire plus tard (Nice to have)
7. Emails de notification (infrastructure SMTP à configurer)
8. Digest hebdomadaire/quotidien par email
9. Notifications in-app (badge compteur)
10. Historique des notifications

## 💡 Architecture recommandée

### Service de notifications unifié
```typescript
class NotificationService {
  // Point d'entrée unique pour TOUTES les notifications
  async notify(params: {
    userId: string;
    type: NotificationType;
    data: any;
    channels?: ('push' | 'socket' | 'email')[];
  }): Promise<void> {
    // 1. Charger les préférences
    const prefs = await this.getPreferences(params.userId);

    // 2. Vérifier si l'utilisateur veut ce type
    if (!this.isEnabled(prefs, params.type)) return;

    // 3. Vérifier le throttling
    if (await this.shouldThrottle(params.userId, params.type)) return;

    // 4. Envoyer sur les canaux demandés
    const channels = params.channels || ['push', 'socket'];

    if (channels.includes('socket')) {
      await this.sendSocketNotification(params);
    }

    if (channels.includes('push') && prefs.pushEnabled) {
      await this.sendPushNotification(params);
    }

    if (channels.includes('email') && prefs.emailEnabled) {
      await this.sendEmailNotification(params);
    }

    // 5. Enregistrer dans l'historique (future)
    await this.logNotification(params);
  }
}
```

### Usage simplifié
```typescript
// Au lieu de gérer manuellement tous les canaux
await notificationService.notify({
  userId: targetUserId,
  type: 'NEW_MESSAGE',
  data: {
    senderName: 'Sophie',
    message: 'Salut !',
    conversationId: 'abc123'
  }
});

// Le service gère automatiquement :
// - Vérification des préférences
// - Throttling
// - Envoi multi-canal
// - Logs
```

## 🚨 Avertissements

### Risques actuels
1. **Users frustrés** : Ne reçoivent pas de notifications pour messages/matchs importants
2. **Taux d'engagement faible** : Users oublient de check l'app
3. **Spam potentiel** : Pas de throttling sur messages (peut spammer)
4. **Expérience incohérente** : Certaines notifs marchent, d'autres non

### Impact business
- ❌ **Rétention** : Users arrêtent d'utiliser l'app si notifications manquantes
- ❌ **Satisfaction** : Cases à cocher qui ne font rien = perte de confiance
- ❌ **Matchs manqués** : Riders offline au moment du match ne voient RIEN

## ✅ Recommandation finale

**Implémenter Phase 1 IMMÉDIATEMENT** :
- Push notifications pour messages (30 min)
- Push notifications pour matchings (30 min)
- Push/Socket pour invitations groupe (45 min)

**Puis Phase 2 rapidement** :
- Interface préférences centralisée (3h)

Cela couvrira 90% des besoins utilisateurs et évitera la frustration actuelle.

---

**Date d'audit** : 2025-12-30
**Auditeur** : Claude Sonnet 4.5
**Statut** : 🔴 Action requise immédiatement
