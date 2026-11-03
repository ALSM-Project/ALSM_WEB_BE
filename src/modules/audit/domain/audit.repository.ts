export interface AuditRepository {
  append(input: {
    actorUserId?: string;
    organizationId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, string>;
  }): Promise<void>;
}

export interface IdempotentAuditRepository extends AuditRepository {
  appendOnce(
    eventKey: string,
    input: Parameters<AuditRepository['append']>[0],
    legacy?: { createdAtAfter?: Date },
  ): Promise<void>;
}
export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
