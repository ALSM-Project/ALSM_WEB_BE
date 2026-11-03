import { SupportContextEntity } from './support-context.entity';

export interface SupportContextScope {
  id: string;
  actorUserId: string;
  originalSessionId: string;
  organizationId: string;
}

export interface SupportContextRepository {
  activeForOrigin(
    actorUserId: string,
    originalSessionId: string,
  ): Promise<SupportContextEntity | null>;
  scoped(scope: SupportContextScope): Promise<SupportContextEntity | null>;
  create(context: SupportContextEntity): Promise<void>;
  save(context: SupportContextEntity, expectedRevision: number): Promise<void>;
}
