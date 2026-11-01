import { SupportContextEntity } from '../domain/support-context.entity';

export class SupportContextPresenter {
  static response(context: SupportContextEntity) {
    const props = context.toProps();
    return {
      id: props.id,
      organizationId: props.organizationId,
      readOnly: true,
      state: props.state,
      createdAt: props.createdAt,
      lastActivityAt: props.lastActivityAt,
      expiresAt: props.expiresAt,
      idleExpiresAt: context.idleExpiresAt(),
      endedAt: props.endedAt,
    };
  }
}
