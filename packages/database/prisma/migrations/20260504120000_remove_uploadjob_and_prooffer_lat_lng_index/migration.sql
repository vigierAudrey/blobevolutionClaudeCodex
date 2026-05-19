-- DANGEROUS-DDL-APPROVED: UploadJob is a dead placeholder model for upload idempotency
-- (IDP-1/IDP-2/IDP-3). Zero production code reads or writes this table — confirmed by
-- exhaustive grep of apps/api/src/ and apps/web/ (zero matches). The actual finalize flow
-- uses a Redis Lua script (upload-token.ts). The table is structurally empty in staging/prod.
--
-- DANGEROUS-DDL-APPROVED: ProOffer_lat_lng_idx is a plain btree index on float columns.
-- Spatial queries use the PostGIS geography index (20260306103000_align_geo_indexes_geography).
-- This btree adds write overhead with zero read benefit for geo queries.

-- DropForeignKey
ALTER TABLE "UploadJob" DROP CONSTRAINT "UploadJob_userId_fkey";

-- DropIndex
DROP INDEX "ProOffer_lat_lng_idx";

-- DropTable
DROP TABLE "UploadJob";

-- DropEnum
DROP TYPE "UploadJobStatus";
