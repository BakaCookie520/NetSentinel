ALTER TABLE "Monitor"
ADD COLUMN "publicStatusEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "publicDisplayName" TEXT,
ADD COLUMN "publicGroup" TEXT NOT NULL DEFAULT '服务状态',
ADD COLUMN "publicOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "Monitor"
SET "publicStatusEnabled" = true,
    "publicDisplayName" = "name";

ALTER TABLE "ProbeResult"
ADD COLUMN "sourceJobId" TEXT,
ADD COLUMN "maintenanceSuppressed" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "ProbeResult_sourceJobId_key" ON "ProbeResult"("sourceJobId");

CREATE TABLE "StatusDailyMetric" (
  "monitorId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "StatusDailyMetric_pkey" PRIMARY KEY ("monitorId", "day"),
  CONSTRAINT "StatusDailyMetric_monitorId_fkey"
    FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "StatusDailyMetric_day_idx" ON "StatusDailyMetric"("day");

INSERT INTO "StatusDailyMetric" ("monitorId", "day", "successCount", "failureCount")
SELECT
  "monitorId",
  DATE_TRUNC('day', "checkedAt" AT TIME ZONE 'UTC')::date,
  COUNT(*) FILTER (WHERE "ok")::integer,
  COUNT(*) FILTER (WHERE NOT "ok")::integer
FROM "ProbeResult"
WHERE "checkedAt" >= CURRENT_TIMESTAMP - INTERVAL '90 days'
GROUP BY "monitorId", DATE_TRUNC('day', "checkedAt" AT TIME ZONE 'UTC')::date;

INSERT INTO "Setting" ("key", "value", "version", "updatedAt") VALUES
  ('statusPageEnabled', 'true'::jsonb, 1, CURRENT_TIMESTAMP),
  ('statusPageTitle', '"NetSentinel Status"'::jsonb, 1, CURRENT_TIMESTAMP),
  ('statusPageDescription', '"服务运行状态与历史可用性。"'::jsonb, 1, CURRENT_TIMESTAMP),
  ('statusPageSupportUrl', 'null'::jsonb, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
