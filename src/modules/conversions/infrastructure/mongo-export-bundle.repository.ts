import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { toValidObjectId } from '../../../shared/utils/object-id.util';
import {
  ExportBundleRecord,
  ExportBundleRepository,
  ExportNotificationStatus,
} from '../domain/export.types';
import { ExportBundle, ExportBundleDocument } from './export-bundle.schema';

/** API path (relative to /api/v1) that streams a stored bundle back. */
export function bundleDownloadUrl(projectId: string, bundleId: string): string {
  return `/projects/${projectId}/partner-export/bundles/${bundleId}/download`;
}

export function mapExportBundle(doc: ExportBundleDocument): ExportBundleRecord {
  const projectId = doc.projectId.toString();
  return {
    id: doc.id,
    projectId,
    organizationId: doc.organizationId.toString(),
    partnerId: doc.partnerId?.toString(),
    partnerEmail: doc.partnerEmail,
    packageName: doc.packageName,
    format: doc.format,
    fileSizeBytes: doc.fileSizeBytes,
    screensIncluded: doc.screensIncluded,
    programsIncluded: doc.programsIncluded,
    excludedItems: (doc.excludedItems ?? []).map((i) => ({ name: i.name, reason: i.reason })),
    customNotes: doc.customNotes,
    storageReference: doc.storageReference,
    exportedAt: doc.exportedAt,
    exportedBy: doc.exportedBy.toString(),
    notificationStatus: doc.notificationStatus,
    notificationError: doc.notificationError,
    notifiedAt: doc.notifiedAt,
    downloadUrl: bundleDownloadUrl(projectId, doc.id),
  };
}

@Injectable()
export class MongoExportBundleRepository implements ExportBundleRepository {
  constructor(@InjectModel(ExportBundle.name) private readonly model: Model<ExportBundle>) {}

  async findById(id: string, organizationId: string): Promise<ExportBundleRecord | null> {
    const doc = await this.model
      .findOne({ _id: toValidObjectId(id), organizationId: toValidObjectId(organizationId) })
      .exec();
    return doc ? mapExportBundle(doc) : null;
  }

  async listByProject(projectId: string, organizationId: string): Promise<ExportBundleRecord[]> {
    const docs = await this.model
      .find({
        projectId: toValidObjectId(projectId),
        organizationId: toValidObjectId(organizationId),
      })
      .sort({ exportedAt: -1 })
      .exec();
    return docs.map(mapExportBundle);
  }

  async updateNotification(
    id: string,
    organizationId: string,
    update: { status: ExportNotificationStatus; error?: string; notifiedAt?: Date },
  ): Promise<ExportBundleRecord | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: toValidObjectId(id), organizationId: toValidObjectId(organizationId) },
        update.error
          ? {
              $set: { notificationStatus: update.status, notificationError: update.error },
            }
          : {
              $set: { notificationStatus: update.status, notifiedAt: update.notifiedAt },
              $unset: { notificationError: 1 },
            },
        { new: true },
      )
      .exec();
    return doc ? mapExportBundle(doc) : null;
  }
}
