/** Public RBAC contract. No Admin permission expansion or client role claims. */
export interface SupportStaffAuthority {
  binding: string;
  expiresAt?: Date;
}

export interface SupportStaffAuthorityPort {
  current(userId: string, now: Date): Promise<SupportStaffAuthority | null>;
}

export const SUPPORT_STAFF_AUTHORITY = Symbol('SUPPORT_STAFF_AUTHORITY');
export const SUPPORT_STAFF_ROLE = 'INTERNAL_SUPPORT';
export const SUPPORT_STAFF_PERMISSION = 'organizations.impersonate';
