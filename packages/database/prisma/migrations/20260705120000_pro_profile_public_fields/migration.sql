-- Page publique /pros/[slug] : champs de publication du profil pro.
-- publicEnabled defaults false : opt-in RGPD explicite, aucun profil existant n'est publié rétroactivement.
-- publicCity est la seule localisation publique (déclarée par le pro) — lat/lng restent privées.
ALTER TABLE "ProProfile"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "publicEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publicCity" TEXT;

CREATE UNIQUE INDEX "ProProfile_slug_key" ON "ProProfile"("slug");

CREATE INDEX "ProProfile_publicEnabled_idx" ON "ProProfile"("publicEnabled");
