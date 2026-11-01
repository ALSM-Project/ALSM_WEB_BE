import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  DiagnosticReadQuery,
  DiagnosticReadTransaction,
  DiagnosticRow,
} from '../../../shared/application/diagnostic-read.port';
import {
  diagnosticId,
  diagnosticMissing,
  diagnosticOrganization,
  diagnosticReference,
  diagnosticView,
  MongoDiagnosticRead,
} from '../../../shared/database/mongo-diagnostic-read';
import { SupportFindingReaderFactory } from '../application/support-finding-reader.port';
import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
  ValidationFindingSource,
  ValidationFindingStatus,
} from '../domain/validation-finding.types';
import { FindingSeverity, FindingStatus } from '../../conversions/domain/validation.types';
@Injectable()
export class MongoSupportFindingReader implements SupportFindingReaderFactory {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  bind(transaction: DiagnosticReadTransaction) {
    const reader = new MongoDiagnosticRead(transaction, this.connection);
    return {
      read: async (query: DiagnosticReadQuery) => {
        if (!query.projectId) throw diagnosticMissing();
        const rows = await reader.rows(
          'validation_findings',
          query,
          {
            ...diagnosticOrganization(query.organizationId, true),
            projectId: diagnosticReference(query.projectId),
          },
          [
            'conversionJobId',
            'validationRunId',
            'source',
            'category',
            'severity',
            'status',
            'confidence',
            'createdAt',
            'updatedAt',
          ],
        );
        const result: DiagnosticRow[] = [];
        // Sequential operations: MongoDB does not support parallel operations in a transaction.
        for (const row of rows) {
          const jobId = diagnosticId(row.conversionJobId),
            runId = diagnosticId(row.validationRunId);
          const runs = await reader.rows(
            'validation_runs',
            { ...query, id: runId, afterId: undefined },
            {
              ...diagnosticOrganization(query.organizationId),
              projectId: diagnosticReference(query.projectId),
              conversionJobId: diagnosticReference(jobId),
            },
            [],
          );
          if (runs.length !== 1) throw diagnosticMissing();
          result.push({
            view: {
              ...diagnosticView(
                row,
                {
                  source: [
                    ...Object.values(ValidationFindingSource),
                    'Rule Validator',
                    'AI Validator',
                  ],
                  category: Object.values(ValidationFindingCategory),
                  severity: [
                    ...Object.values(ValidationFindingSeverity),
                    ...Object.values(FindingSeverity),
                  ],
                  status: [
                    ...Object.values(ValidationFindingStatus),
                    ...Object.values(FindingStatus),
                  ],
                },
                [],
                ['confidence'],
              ),
              conversionJobId: jobId,
              validationRunId: runId,
            },
            conversionJobId: jobId,
          });
        }
        return result;
      },
    };
  }
}
