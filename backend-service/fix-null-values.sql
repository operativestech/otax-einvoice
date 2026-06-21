-- Fix existing NULL values in credentials table before Prisma push
UPDATE "otaxdb".credentials 
SET "isDemo" = false 
WHERE "isDemo" IS NULL;

-- Verify the update
SELECT id, username, "isDemo", "isValid" 
FROM "otaxdb".credentials;
