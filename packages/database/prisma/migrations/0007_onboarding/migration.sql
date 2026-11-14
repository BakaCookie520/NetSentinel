CREATE TABLE "AccountSecurity" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "totpEncrypted" JSONB,
  "totpLastCounter" INTEGER NOT NULL DEFAULT -1,
  "recoveryHash" TEXT,
  "backupHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE "DurableJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "error" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX "DurableJob_status_availableAt_idx" ON "DurableJob"("status", "availableAt");
