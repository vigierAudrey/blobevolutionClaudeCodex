-- Un seul niveau par (profileId, sport) sur RiderDiscipline.
-- 1) Déduplique les lignes existantes en conservant la plus récente
--    (updatedAt max, puis id max en cas d'égalité).
DELETE FROM "RiderDiscipline" a
USING "RiderDiscipline" b
WHERE a."profileId" = b."profileId"
  AND a."sport" = b."sport"
  AND (a."updatedAt" < b."updatedAt"
       OR (a."updatedAt" = b."updatedAt" AND a."id" < b."id"));

-- 2) Contrainte d'unicité (nom conforme à la convention Prisma).
CREATE UNIQUE INDEX "RiderDiscipline_profileId_sport_key"
ON "RiderDiscipline"("profileId", "sport");
