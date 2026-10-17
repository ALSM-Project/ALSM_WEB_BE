import { ConflictException } from '@nestjs/common';
import {
  businessMutation,
  completedAudit,
  requestedAudit,
} from '../src/modules/teams/application/team-mutation-outcome';

describe('team mutation failure outcomes', () => {
  const unavailable = async () => {
    throw new Error('private database details');
  };
  it('distinguishes a rejected audit before a mutation from a persisted mutation', async () => {
    await expect(requestedAudit(unavailable)).rejects.toMatchObject({
      response: {
        code: 'TEAM_AUDIT_UNAVAILABLE',
        mutationCommitted: false,
        retrySafe: false,
      },
    });
    await expect(completedAudit(unavailable, 'resource', 7)).rejects.toMatchObject({
      response: {
        code: 'TEAM_MUTATION_COMMITTED_AUDIT_PENDING',
        mutationCommitted: true,
        retrySafe: false,
        resourceId: 'resource',
        revision: 7,
      },
    });
  });
  it('does not claim rollback after an uncertain database result or expose driver details', async () => {
    await expect(businessMutation(unavailable, 'resource')).rejects.toMatchObject({
      response: {
        code: 'TEAM_MUTATION_OUTCOME_UNCONFIRMED',
        mutationCommitted: 'unknown',
        retrySafe: false,
        resourceId: 'resource',
      },
    });
  });
  it('preserves deliberate conflicts and successful results', async () => {
    const conflict = new ConflictException('changed');
    await expect(
      businessMutation(async () => {
        throw conflict;
      }, 'resource'),
    ).rejects.toBe(conflict);
    await expect(businessMutation(async () => ({ persisted: true }), 'resource')).resolves.toEqual({
      persisted: true,
    });
  });
});
