import { HttpException, ServiceUnavailableException } from '@nestjs/common';

/** Central audit and business writes use separate ports: never report rollback on failure. */
export async function requestedAudit(append: () => Promise<unknown>) {
  try {
    await append();
  } catch {
    throw new ServiceUnavailableException({
      code: 'TEAM_AUDIT_UNAVAILABLE',
      message: 'Requested-action audit failed; this request did not attempt the business mutation',
      mutationCommitted: false,
      retrySafe: false,
      details: [{ mutationCommitted: false, retrySafe: false }],
    });
  }
}

export async function businessMutation<T>(write: () => Promise<T>, resourceId: string) {
  try {
    return await write();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException({
      code: 'TEAM_MUTATION_OUTCOME_UNCONFIRMED',
      message: 'Database outcome is unknown; reconcile persisted state before retrying',
      resourceId,
      mutationCommitted: 'unknown',
      retrySafe: false,
      details: [{ resourceId, mutationCommitted: 'unknown', retrySafe: false }],
    });
  }
}

export async function completedAudit(
  append: () => Promise<unknown>,
  resourceId: string,
  revision?: number,
) {
  try {
    await append();
  } catch {
    throw new ServiceUnavailableException({
      code: 'TEAM_MUTATION_COMMITTED_AUDIT_PENDING',
      message:
        'Business mutation persisted; completion audit failed. Reconcile before further changes',
      resourceId,
      revision,
      mutationCommitted: true,
      retrySafe: false,
      details: [{ resourceId, revision, mutationCommitted: true, retrySafe: false }],
    });
  }
}
