export const SUPPORT_OPERATION_EVIDENCE = Symbol('SUPPORT_OPERATION_EVIDENCE');
export interface SupportOperationEvidence {
  find(scope: {
    actorUserId: string;
    originalSessionId: string;
    organizationId: string;
    contextId: string;
    operationId: string;
  }): Promise<{ action: string; operation: string } | null>;
}
