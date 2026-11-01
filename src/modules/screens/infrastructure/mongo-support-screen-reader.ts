import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  DiagnosticReadQuery,
  DiagnosticReadTransaction,
} from '../../../shared/application/diagnostic-read.port';
import {
  diagnosticMissing,
  diagnosticOrganization,
  diagnosticReference,
  diagnosticView,
  MongoDiagnosticRead,
} from '../../../shared/database/mongo-diagnostic-read';
import { SupportScreenReaderFactory } from '../application/support-screen-reader.port';
import { ScreenSourceType, ScreenStatus } from '../domain/screen.types';
@Injectable()
export class MongoSupportScreenReader implements SupportScreenReaderFactory {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  bind(transaction: DiagnosticReadTransaction) {
    const reader = new MongoDiagnosticRead(transaction, this.connection);
    return {
      read: async (query: DiagnosticReadQuery) => {
        if (!query.projectId || !['screens', 'programs'].includes(query.kind))
          throw diagnosticMissing();
        const rows = await reader.rows(
          'screens',
          query,
          {
            ...diagnosticOrganization(query.organizationId, true),
            projectId: diagnosticReference(query.projectId),
            sourceType: query.kind === 'programs' ? 'COBOL' : { $in: ['BMS', 'DSPF'] },
          },
          [
            'name',
            'sourceType',
            'status',
            'sizeBytes',
            'dependencyStatus',
            'createdAt',
            'updatedAt',
          ],
        );
        return rows.map((row) => ({
          view: diagnosticView(
            row,
            {
              sourceType: Object.values(ScreenSourceType),
              status: Object.values(ScreenStatus),
              dependencyStatus: ['READY_FOR_CONVERSION', 'BLOCKED', 'NOT_ANALYZED'],
            },
            ['name'],
            ['sizeBytes'],
          ),
        }));
      },
    };
  }
}
