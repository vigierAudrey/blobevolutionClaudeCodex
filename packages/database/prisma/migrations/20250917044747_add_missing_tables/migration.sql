-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('RIDER_TO_RIDER', 'RIDER_TO_PRO', 'PRO_TO_PRO');

-- CreateEnum
CREATE TYPE "Sport" AS ENUM ('surf', 'kitesurf');

-- CreateEnum
CREATE TYPE "Level" AS ENUM ('beginner', 'intermediate', 'advanced');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('WELCOME_BONUS', 'ADMIN_GRANT', 'LESSON_BOOKING', 'LESSON_REFUND', 'PROMO_BONUS', 'REFERRAL_BONUS');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "type" "ConversationType" NOT NULL DEFAULT 'RIDER_TO_RIDER';

-- CreateTable
CREATE TABLE "AdminProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProOffer" (
    "id" TEXT NOT NULL,
    "proProfileId" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "level" "Level" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hourlyRate" DECIMAL(5,2) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceBefore" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminProfile_userId_key" ON "AdminProfile"("userId");

-- CreateIndex
CREATE INDEX "AdminProfile_userId_idx" ON "AdminProfile"("userId");

-- CreateIndex
CREATE INDEX "ProOffer_sport_level_idx" ON "ProOffer"("sport", "level");

-- CreateIndex
CREATE INDEX "ProOffer_lat_lng_idx" ON "ProOffer"("lat", "lng");

-- CreateIndex
CREATE INDEX "ProOffer_isActive_idx" ON "ProOffer"("isActive");

-- CreateIndex
CREATE INDEX "ProOffer_proProfileId_idx" ON "ProOffer"("proProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "UserWallet_userId_key" ON "UserWallet"("userId");

-- CreateIndex
CREATE INDEX "UserWallet_userId_idx" ON "UserWallet"("userId");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_idx" ON "CreditTransaction"("userId");

-- CreateIndex
CREATE INDEX "CreditTransaction_createdAt_idx" ON "CreditTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_type_idx" ON "CreditTransaction"("type");

-- CreateIndex
CREATE INDEX "Conversation_type_idx" ON "Conversation"("type");

-- AddForeignKey
ALTER TABLE "AdminProfile" ADD CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProOffer" ADD CONSTRAINT "ProOffer_proProfileId_fkey" FOREIGN KEY ("proProfileId") REFERENCES "ProProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWallet" ADD CONSTRAINT "UserWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
