-- Sprint C7 : diagnostic géographique marketplace.
-- Ajoute zoneLarge sur LessonFanout pour permettre le GROUP BY zone dans analytics/overview.
--
-- Justification : LessonFanout ne stocke aucune donnée géo. riderRef et lessonRequestId sont
-- des hashes SHA-256 non-réversibles — il n'existe aucun chemin de jointure vers
-- RiderProfile.lessonLat/lessonLng. La seule façon de lier un fanout à une zone est de la
-- capturer au moment du fanout, quand lessonLat/lessonLng sont disponibles dans le service.
--
-- zoneLarge = Z${floor(lat)}:${floor(lng)} avec grille 1° ≈ 111 km (identique à AnalyticsEvent).
-- NULL pour les lignes antérieures à ce sprint — exclues du GROUP BY analytics.
--
-- DDL en ligne sur PostgreSQL 12+ (ADD COLUMN nullable = sans réécriture de table).

ALTER TABLE "LessonFanout" ADD COLUMN "zoneLarge" TEXT;
