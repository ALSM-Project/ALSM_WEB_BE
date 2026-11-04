import { NotFoundException } from '@nestjs/common';
import { ClientSession, Connection, Model } from 'mongoose';
import { MongoTransactionRunner } from '../../../shared/database/mongo-transaction-runner';
import { toValidObjectId } from '../../../shared/utils/object-id.util';
import { AuditRepository } from '../../audit/domain/audit.repository';
import { Partner } from '../../partners/infrastructure/partner.schema';
import { ProjectStatus } from '../../projects/domain/project.types';
import { Project } from '../../projects/infrastructure/project.schema';
import {
  ExportBundleRecord,
  ExportPublication,
  ExportPublicationUnitOfWork,
} from '../domain/export.types';
import { ExportBundle } from './export-bundle.schema';
import { mapExportBundle } from './mongo-export-bundle.repository';

export const PARTNER_PROJECT_CODE_EXPORTED = 'PARTNER_PROJECT_CODE_EXPORTED';

/** Commits the project, partner, bundle and audit writes of a UC-48 release in one transaction. */
export class MongoExportPublicationUnitOfWork implements ExportPublicationUnitOfWork {
  constructor(
    private readonly connection: Connection,
    private readonly projects: Model<Project>,
    private readonly partners: Model<Partner>,
    private readonly bundles: Model<ExportBundle>,
    private readonly audit: (session: ClientSession, connection: Connection) => AuditRepository,
  ) {}

  commit(publication: ExportPublication): Promise<ExportBundleRecord> {
    const { bundle } = publication;
    return new MongoTransactionRunner(this.connection).run(async (session) => {
      const organizationObjectId = toValidObjectId(publication.organizationId);
      const project = await this.projects
        .updateOne(
          {
            _id: toValidObjectId(publication.projectId),
            organizationId: { $in: [organizationObjectId, publication.organizationId] },
            deletedAt: { $exists: false },
          },
          {
            $set: {
              status: ProjectStatus.COMPLETED,
              isExported: true,
              exportedAt: bundle.exportedAt,
              exportedBundleName: bundle.packageName,
            },
          },
          { session },
        )
        .exec();
      if (project.matchedCount !== 1) {
        // Deleted between building the bundle and publishing it: nothing is committed.
        throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project was not found' });
      }

      const partner = await this.partners
        .findOneAndUpdate(
          { contactEmail: publication.partnerEmail.trim().toLowerCase() },
          {
            $inc: { completedExportCount: 1 },
            $set: { latestActivity: `Exported ${bundle.packageName}` },
          },
          { session, new: true },
        )
        .exec();

      const [doc] = await this.bundles.create(
        [
          {
            _id: toValidObjectId(bundle.id),
            projectId: toValidObjectId(bundle.projectId),
            organizationId: organizationObjectId,
            partnerId: partner?._id,
            partnerEmail: bundle.partnerEmail,
            packageName: bundle.packageName,
            format: bundle.format,
            fileSizeBytes: bundle.fileSizeBytes,
            screensIncluded: bundle.screensIncluded,
            programsIncluded: bundle.programsIncluded,
            excludedItems: bundle.excludedItems,
            customNotes: bundle.customNotes,
            storageReference: bundle.storageReference,
            exportedAt: bundle.exportedAt,
            exportedBy: toValidObjectId(bundle.exportedBy),
            notificationStatus: bundle.notificationStatus,
          },
        ],
        { session },
      );

      await this.audit(session, this.connection).append({
        actorUserId: publication.actorUserId,
        organizationId: publication.organizationId,
        action: PARTNER_PROJECT_CODE_EXPORTED,
        resourceType: 'PROJECT',
        resourceId: publication.projectId,
        metadata: {
          bundleId: bundle.id,
          packageName: bundle.packageName,
          partnerEmail: bundle.partnerEmail,
          screensIncluded: String(bundle.screensIncluded),
          programsIncluded: String(bundle.programsIncluded),
          excludedCount: String(bundle.excludedItems.length),
        },
      });

      return mapExportBundle(doc);
    }, publication.projectId);
  }
}
