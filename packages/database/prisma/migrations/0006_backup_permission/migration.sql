UPDATE "Role"
SET "permissions" = array_append("permissions", 'backup:manage'),
    "version" = "version" + 1
WHERE "name" = 'system-admin' AND "system" = true
  AND NOT ('backup:manage' = ANY("permissions"));
