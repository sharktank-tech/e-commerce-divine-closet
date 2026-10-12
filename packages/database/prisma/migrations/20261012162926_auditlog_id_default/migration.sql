-- AuditLog.id sem default no banco (schema declara gen_random_uuid).
ALTER TABLE "AuditLog" ALTER COLUMN id SET DEFAULT gen_random_uuid();
