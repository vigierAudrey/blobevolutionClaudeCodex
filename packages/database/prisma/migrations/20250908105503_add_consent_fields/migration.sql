-- AlterTable
ALTER TABLE "User" ADD COLUMN     "consentIp" TEXT;

-- CreateTable
CREATE TABLE "LastSearch" (
    "userId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "partner" "PartnerPref",
    "distanceKm" INTEGER,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LastSearch_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "LastSearch" ADD CONSTRAINT "LastSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
