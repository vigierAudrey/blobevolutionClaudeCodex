Blobinfini – Project Brief (MVP)

Vision
- Marketplace communautaire pour sports de glisse (surf/kitesurf): matching, réservation, paiement, messagerie, gamification.

MVP (Phase 1)
- Auth module intégré à l’API: register, login, refresh, logout, reset password.
- Profils riders/pros (basique), matching simple, réservation + paiement Stripe (simple), chat 1‑to‑1, PWA mobile‑first.

Stack cible
- Front: Next.js 14 (App Router), TS strict, Tailwind, shadcn/ui.
- API: Node.js + Express modulaire.
- DB: PostgreSQL (+ PostGIS), Prisma ORM.
- Temps réel: Socket.IO, Redis (cache/pubsub).
- Services: Stripe, Twilio (2FA SMS optionnel plus tard), Maps, Firebase notif.

Contraintes
- Sécurité forte: Zod partout, JWT + refresh, rate limit, headers/CSRF, RGPD.
- Qualité: tests ≥ 80% sur Auth, CI/CD, docs courtes mais à jour.
