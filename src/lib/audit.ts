import { auditLog } from "./db/schema";
import type { Db } from "./db/client";

export interface AuditLogEntry {
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(db: Db, entry: AuditLogEntry): Promise<void> {
  await db.insert(auditLog).values({
    id: crypto.randomUUID(),
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
    createdAt: new Date(),
  });
}
