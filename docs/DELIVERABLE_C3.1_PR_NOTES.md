# Deliverable C3.1: Correctif Optimistic Cleanup + InFlight Guard — PR Notes

**Date**: 2026-01-13
**Scope**: `apps/web/app/messages/[id]/page-websocket.tsx` uniquement
**Goal**: Corriger 2 bugs sans changer le design

---

## Summary

Mini PR correctif pour C3 : fixe le cleanup des optimistic après success + simplifie le guard inFlight.

**Diff**: +24 insertions, -61 deletions (-37 lignes nettes)

---

## FIX 1 (OBLIGATOIRE): Bug Cleanup Après Success

### Problème

**Avant C3.1** (lignes 319-339):
```typescript
if (result.success) {
  // Marquer inFlight=false
  setOptimisticMessages(prev =>
    prev.map(m =>
      m.clientMsgId === clientMsgId ? { ...m, inFlight: false } : m
    )
  );

  setError(null);

  // Reload messages if HTTP fallback was used + cleanup optimistic
  if (result.transport === 'HTTP') {
    await loadMessages();
    setOptimisticMessages(prev =>
      prev.filter(opt =>
        opt.status === 'failed' ||
        (Date.now() - opt.createdAtLocal) >= 5000 // BUG: garde les vieux, supprime les récents
      )
    );
  }
}
```

**Bugs identifiés**:
1. **Condition inversée** : `>= 5000` garde les vieux et supprime les récents (l'inverse voulu)
2. **Pas de suppression explicite** : L'optimistic reste après success WS (dépend uniquement de onNewMessage)
3. **Cleanup imprécis** : Après HTTP fallback, on ne cible pas le bon optimistic

### Solution

**Après C3.1**:
```typescript
if (result.success) {
  setError(null);

  // C3.1 FIX 1: Supprimer explicitement l'optimistic par clientMsgId (succès confirmé)
  setOptimisticMessages(prev =>
    prev.filter(opt => opt.clientMsgId !== clientMsgId)
  );

  // HTTP fallback : reload pour récupérer le message serveur
  if (result.transport === 'HTTP') {
    await loadMessages();
  }
  // WS: le message serveur arrivera via onNewMessage (réconciliation safety net)

  return;
}
```

**Améliorations**:
- ✅ **Suppression explicite par clientMsgId** : Plus de confusion temporelle
- ✅ **Fonctionne pour WS et HTTP** : Pas de branches spéciales
- ✅ **Plus simple** : Suppression immédiate après success (pas d'attente onNewMessage)
- ✅ **Safety net conservé** : onNewMessage fait toujours le matching par content (au cas où)

**Appliqué à** : `send()` (line 315-329), `sendProposal()` (line 387-405), `retryMessage()` (line 461-475)

---

## FIX 2 (RECOMMANDÉ): Guard InFlight Trop Global

### Problème

**Avant C3.1** (lignes 294-298):
```typescript
// C3: Anti-dup - vérifier si déjà en cours (single-flight par clientMsgId)
const alreadyInFlight = optimisticMessages.some(m => m.inFlight);
if (alreadyInFlight) {
  return; // Ignorer silently
}
```

**Issue** : Bloque TOUT envoi si N'IMPORTE QUEL message est `inFlight`.

**Exemple** : Si un message TEXT est inFlight, impossible d'envoyer une PROPOSAL (ou vice-versa).

### Solution

**Après C3.1** : Guard supprimé complètement.

**Pourquoi safe ?**
1. **Boutons disabled** : Déjà disabled pendant `inFlight` (line 684, 692, 710)
2. **Input disabled** : Ajout de `disabled={!!rateLimitedUntil || optimisticMessages.some(m => m.inFlight)}` (line 675)
3. **Enter disabled** : Condition `onKeyDown` modifiée pour empêcher Enter si `inFlight` (line 670)

**Code input** (line 664-676):
```typescript
<input
  ...
  onKeyDown={(e)=>{
    if(e.key==='Enter' && !rateLimitedUntil && !optimisticMessages.some(m => m.inFlight)){
      e.preventDefault();
      send();
    }
  }}
  disabled={!!rateLimitedUntil || optimisticMessages.some(m => m.inFlight)}
/>
```

**UX cohérente** : Tant qu'un message est inFlight, tout est disabled (input + boutons).

**Appliqué à** : `send()` (line 294-295 supprimé), `sendProposal()` (line 364-367 supprimé)

---

## Behavior Changes

### User-Facing (Subtle)

**Avant C3.1** :
- Message pending restait visible même après success WS jusqu'à onNewMessage (~100ms)
- Après success HTTP, cleanup imprécis pouvait laisser des optimistic fantômes

**Après C3.1** :
- Message pending supprimé IMMÉDIATEMENT après success (WS ou HTTP)
- Cleanup ciblé par clientMsgId (plus de fantômes)
- Input disabled pendant envoi (empêche spam Enter)

### Internal

- **Cleanup simplifié** : Plus de condition temporelle (age < 5000), juste filter par clientMsgId
- **Code réduit** : -37 lignes nettes (suppression guards + simplification cleanup)
- **Réconciliation WS** : Toujours active comme safety net, mais pas nécessaire dans 99% des cas

---

## Anti-Regression Checklist

✅ **1 send = 1 message** : Toujours garanti (clientMsgId unique, suppression explicite)

✅ **Retry no-dup** : Réutilise même clientMsgId (inchangé)

✅ **RATE_LIMITED cooldown** : Inchangé (input + boutons disabled)

✅ **Failed messages préservés** : Toujours gardés pour retry (aucun cleanup ne les touche)

✅ **Double-clic prevented** : Boutons disabled pendant inFlight (ligne 684, 692, 710)

✅ **Spam Enter prevented** : Input disabled + condition onKeyDown (ligne 670, 675)

---

## Code Diff Summary

```diff
send() {
-  // C3: Anti-dup - vérifier si déjà en cours
-  const alreadyInFlight = optimisticMessages.some(m => m.inFlight);
-  if (alreadyInFlight) return;
+  // C3.1 FIX 2: Guard removed - buttons already disabled

  const result = await sendMessage(...);

  if (result.success) {
-    // Marquer inFlight=false
-    setOptimisticMessages(prev =>
-      prev.map(m => m.clientMsgId === clientMsgId ? { ...m, inFlight: false } : m)
-    );
-
-    if (result.transport === 'HTTP') {
-      await loadMessages();
-      setOptimisticMessages(prev =>
-        prev.filter(opt =>
-          opt.status === 'failed' ||
-          (Date.now() - opt.createdAtLocal) >= 5000 // BUG
-        )
-      );
-    }
+    // C3.1 FIX 1: Supprimer explicitement par clientMsgId
+    setOptimisticMessages(prev =>
+      prev.filter(opt => opt.clientMsgId !== clientMsgId)
+    );
+
+    if (result.transport === 'HTTP') {
+      await loadMessages();
+    }
  }
}

// Input
<input
  onKeyDown={(e)=>{
-    if(e.key==='Enter' && !rateLimitedUntil){
+    if(e.key==='Enter' && !rateLimitedUntil && !optimisticMessages.some(m => m.inFlight)){
      e.preventDefault();
      send();
    }
  }}
-  disabled={!!rateLimitedUntil}
+  disabled={!!rateLimitedUntil || optimisticMessages.some(m => m.inFlight)}
/>
```

**Total** : -37 lignes (simplification)

---

## Next Steps (Out of Scope C3.1)

Aucun changement prévu. C3.1 est un correctif uniquement.

**C4 (futur)** : Appliquer pending/failed/retry à booking/matching/reporting (pas impacté par C3.1).

---

## Commit Message

```
fix(web): correct optimistic cleanup and inFlight guard (C3.1)

Fix 2 bugs in optimistic message handling without changing design.

FIX 1 (cleanup after success):
- Before: Wrong condition (>= 5000) kept old and removed recent optimistic
- After: Explicit removal by clientMsgId (works for WS + HTTP)
- Applied to: send(), sendProposal(), retryMessage()

FIX 2 (inFlight guard):
- Before: Global guard blocked all sends if any message inFlight
- After: Guard removed (buttons already disabled during inFlight)
- Added: Input disabled + Enter check during inFlight (anti-spam)

Result:
- Cleaner code (-37 lines)
- Targeted cleanup (no orphan optimistic messages)
- Consistent UX (input + buttons disabled during send)

Build: Next.js successful ✅
```

---

**Ready for review!**
