import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SupportOperationEvidence } from '../domain/support-operation-evidence.port';
import { AuditLog } from './audit-log.schema';

@Injectable()
export class MongoSupportOperationEvidence implements SupportOperationEvidence {
  constructor(@InjectModel(AuditLog.name) private readonly audits: Model<AuditLog>) {}
  async find(scope: Parameters<SupportOperationEvidence['find']>[0]) {
    const rows = await this.audits
      .find({
        actorUserId: new Types.ObjectId(scope.actorUserId),
        organizationId: new Types.ObjectId(scope.organizationId),
        'metadata.originalSessionId': scope.originalSessionId,
        'metadata.contextId': scope.contextId,
        'metadata.operationId': scope.operationId,
        action: {
          $in: [
            'SUPPORT_CONTEXT_ENTERED',
            'SUPPORT_CONTEXT_EXITED',
            'SUPPORT_CONTEXT_READ',
            'SUPPORT_WORKSPACE_READ',
          ],
        },
      })
      .select({ action: 1, 'metadata.operation': 1 })
      .limit(2)
      .read('primary')
      .readConcern('majority')
      .maxTimeMS(2000)
      .lean()
      .exec();
    // Missing or ambiguous durable evidence never proves a rollback.
    return rows.length === 1
      ? { action: rows[0].action, operation: rows[0].metadata?.operation ?? rows[0].action }
      : null;
  }
}
