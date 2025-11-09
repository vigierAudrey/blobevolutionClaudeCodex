-- RemoveCreditsSystem Migration
-- This migration removes the UserWallet, CreditTransaction models and CreditTransactionType enum
-- No data is backed up as the credits feature was never in production

-- Drop tables (order matters for foreign keys)
DROP TABLE IF EXISTS "CreditTransaction" CASCADE;
DROP TABLE IF EXISTS "UserWallet" CASCADE;

-- Drop enum
DROP TYPE IF EXISTS "CreditTransactionType" CASCADE;
