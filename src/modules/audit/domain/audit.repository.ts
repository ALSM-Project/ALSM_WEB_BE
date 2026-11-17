export enum AuditResourceType {
  USER = 'USER',
  ORGANIZATION = 'ORGANIZATION',
  ROLE = 'ROLE',
  PERMISSION = 'PERMISSION',
  PROJECT = 'PROJECT',
  QUOTE = 'QUOTE',
  CONVERSION = 'CONVERSION',
  CONVERSION_JOB = 'CONVERSION_JOB',
  TEMPORARY_ROLE = 'TEMPORARY_ROLE',
  TEAM = 'TEAM',
  TEAM_JOB_ASSIGNMENT = 'TEAM_JOB_ASSIGNMENT',
  BANK_ACCOUNT = 'BANK_ACCOUNT',
  INVOICE = 'INVOICE',
  ENTERPRISE_QUOTE_REQUEST = 'ENTERPRISE_QUOTE_REQUEST',
  VALIDATION_FINDING = 'VALIDATION_FINDING',
  SUPPORT_CONTEXT = 'SUPPORT_CONTEXT',
  OFFBOARDING_REQUEST = 'OFFBOARDING_REQUEST',
  USER_SESSION = 'USER_SESSION',
  WORKFORCE_MEMBERSHIP = 'WORKFORCE_MEMBERSHIP',
  LEAD = 'LEAD',
  PAYMENT = 'PAYMENT',
  MENU_ITEM = 'MENU_ITEM',
  SYSTEM = 'SYSTEM',
}

export interface AuditRecord {
  id: string;
  actorUserId?: string;
  organizationId?: string;
  action: string;
  resourceType: string | AuditResourceType;
  resourceId?: string;
  metadata?: Record<string, string>;
  createdAt?: Date;
}

export interface AuditRepository {
  append(input: {
    actorUserId?: string;
    organizationId?: string;
    action: string;
    resourceType: string | AuditResourceType;
    resourceId?: string;
    metadata?: Record<string, string>;
  }): Promise<void>;
  findByResource?(resourceType: string, resourceId: string): Promise<AuditRecord[]>;
}

export interface IdempotentAuditRepository extends AuditRepository {
  appendOnce(
    eventKey: string,
    input: Parameters<AuditRepository['append']>[0],
    legacy?: { createdAtAfter?: Date },
  ): Promise<void>;
}
export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
