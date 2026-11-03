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
import { SupportConversionReaderFactory } from '../application/support-conversion-reader.port';
import { ConversionJobStatus } from '../domain/conversion-job.types';
import { ConversionType } from '../../projects/domain/project.types';
import { ErrorLogSeverity, ErrorLogStatus } from '../domain/error-log.types';
@Injectable()
export class MongoSupportConversionReader implements SupportConversionReaderFactory {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  bind(transaction: DiagnosticReadTransaction) {
    const reader = new MongoDiagnosticRead(transaction, this.connection);
    return {
      read: async (query: DiagnosticReadQuery) => {
        if (!query.projectId || !['conversion-logs', 'error-logs'].includes(query.kind))
          throw diagnosticMissing();
        const jobs = query.kind === 'conversion-logs';
        const fields = jobs
          ? ['status', 'conversionType', 'attemptCount', 'maxAttempts', 'createdAt', 'updatedAt']
          : ['severity', 'status', 'lineNumber', 'createdAt', 'updatedAt'];
        const rows = await reader.rows(
          jobs ? 'conversion_jobs' : 'error_logs',
          query,
          {
            ...diagnosticOrganization(query.organizationId),
            projectId: diagnosticReference(query.projectId),
          },
          fields,
        );
        return rows.map((row) => ({
          view: diagnosticView(
            row,
            jobs
              ? {
                  status: Object.values(ConversionJobStatus),
                  conversionType: Object.values(ConversionType),
                }
              : {
                  severity: Object.values(ErrorLogSeverity),
                  status: Object.values(ErrorLogStatus),
                },
            [],
            jobs ? ['attemptCount', 'maxAttempts'] : ['lineNumber'],
          ),
        }));
      },
    };
  }
}
