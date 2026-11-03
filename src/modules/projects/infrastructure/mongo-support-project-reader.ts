import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  DiagnosticReadQuery,
  DiagnosticReadTransaction,
} from '../../../shared/application/diagnostic-read.port';
import {
  diagnosticOrganization,
  diagnosticView,
  MongoDiagnosticRead,
} from '../../../shared/database/mongo-diagnostic-read';
import { SupportProjectReaderFactory } from '../application/support-project-reader.port';
import { ConversionType, ProjectStatus } from '../domain/project.types';

@Injectable()
export class MongoSupportProjectReader implements SupportProjectReaderFactory {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  bind(transaction: DiagnosticReadTransaction) {
    const reader = new MongoDiagnosticRead(transaction, this.connection);
    return {
      read: async (query: DiagnosticReadQuery) => {
        const fields = ['name', 'status', 'conversionType', 'createdAt', 'updatedAt'];
        const rows = await reader.rows(
          'projects',
          query,
          { ...diagnosticOrganization(query.organizationId), deletedAt: null },
          fields,
        );
        return rows.map((row) => ({
          view: diagnosticView(
            row,
            { status: Object.values(ProjectStatus), conversionType: Object.values(ConversionType) },
            ['name'],
          ),
        }));
      },
    };
  }
}
