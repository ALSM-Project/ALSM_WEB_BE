import { UserRecord } from '../../users/domain/user.repository';

/** Unknown account state is never authentication authority. */
export function isAccountAdmitted(
  account: Pick<UserRecord, 'isActive' | 'isLocked'> | null | undefined,
): boolean {
  return account?.isActive === true && account.isLocked === false;
}
