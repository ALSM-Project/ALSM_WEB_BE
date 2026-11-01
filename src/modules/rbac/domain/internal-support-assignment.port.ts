export const INTERNAL_SUPPORT_ASSIGNMENT = Symbol('INTERNAL_SUPPORT_ASSIGNMENT');

/** Denial-only classification using existing persisted role assignments. */
export interface InternalSupportAssignmentPort {
  hasCurrentAssignment(userId: string): Promise<boolean>;
}
