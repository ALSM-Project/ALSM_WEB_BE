import { ServiceUnavailableException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SupportContextEntity } from '../domain/support-context.entity';
import { SupportContextSnapshot } from './support-context.schema';

export function supportContextFromSnapshot(snapshot: SupportContextSnapshot): SupportContextEntity {
  try {
    const { _id, actorUserId, originalSessionId, organizationId, ...props } = snapshot;
    if (
      ![actorUserId, originalSessionId, organizationId].every((id) => id instanceof Types.ObjectId)
    )
      throw new Error('Invalid persisted identifier');
    return SupportContextEntity.fromPersistence({
      ...props,
      id: _id,
      actorUserId: String(actorUserId),
      originalSessionId: String(originalSessionId),
      organizationId: String(organizationId),
    });
  } catch {
    throw new ServiceUnavailableException({
      code: 'SUPPORT_CONTEXT_PERSISTENCE_UNAVAILABLE',
      message: 'Support context state could not be verified',
    });
  }
}

export function supportContextToSnapshot(context: SupportContextEntity): SupportContextSnapshot {
  const { id, actorUserId, originalSessionId, organizationId, ...props } = context.toProps();
  return {
    ...props,
    _id: id,
    actorUserId: new Types.ObjectId(actorUserId),
    originalSessionId: new Types.ObjectId(originalSessionId),
    organizationId: new Types.ObjectId(organizationId),
  };
}
