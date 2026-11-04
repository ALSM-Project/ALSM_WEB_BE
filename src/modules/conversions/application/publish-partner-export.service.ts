import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { MailService } from '../../../shared/mail/mail.service';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { ProjectService } from '../../projects/application/project.service';
import {
  EXPORT_BUNDLE_REPOSITORY,
  EXPORT_PUBLICATION_UNIT_OF_WORK,
  ExportBundleRecord,
  ExportBundleRepository,
  ExportPublicationUnitOfWork,
  PartnerExportConfiguration,
} from '../domain/export.types';
import { PartnerBundleService } from './partner-bundle.service';

/** What a client sees of a bundle: everything except the internal storage reference. */
export type ExportBundleView = Omit<ExportBundleRecord, 'storageReference'>;

export interface PublishPartnerExportRequest {
  partnerEmail: string;
  customNotes?: string;
  options: Omit<PartnerExportConfiguration, 'projectId' | 'customNotes'>;
}

const SMTP_NOT_CONFIGURED = 'Email delivery is not configured on the server, so the partner was not notified';
const DELIVERY_FAILED = 'The notification email could not be delivered. Retry it from the export history';

/**
 * UC-48: packages the project, stores the ZIP, records the release (project, partner,
 * bundle and audit in one transaction) and then emails the partner. A failed email never
 * undoes the release - the bundle stays published with notificationStatus FAILED and the
 * notification can be retried.
 */
@Injectable()
export class PublishPartnerExportService {
  private readonly logger = new Logger(PublishPartnerExportService.name);

  constructor(
    private readonly bundleBuilder: PartnerBundleService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(EXPORT_PUBLICATION_UNIT_OF_WORK) private readonly publication: ExportPublicationUnitOfWork,
    @Inject(EXPORT_BUNDLE_REPOSITORY) private readonly bundles: ExportBundleRepository,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly organizationContext: OrganizationContextService,
    private readonly projects: ProjectService,
  ) {}

  async publish(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    request: PublishPartnerExportRequest,
  ): Promise<ExportBundleView> {
    const partnerEmail = request.partnerEmail.trim().toLowerCase();
    const customNotes = request.customNotes?.trim() || undefined;
    const built = await this.bundleBuilder.build(userId, organizationHeader, projectId, {
      ...request.options,
      customNotes,
    });
    this.bundleBuilder.assertHasContent(built);

    const buffer = await this.bundleBuilder.zip(built);
    const bundleId = new Types.ObjectId().toHexString();
    // Written before the transaction: a ZIP without a record is harmless, a record without its ZIP is not.
    const storageReference = await this.storage.writeFiles(
      `org/${built.organizationId}/project/${built.project.id}/exports/${bundleId}`,
      [{ relativePath: built.packageName, content: buffer }],
    );

    const record = await this.publication.commit({
      actorUserId: userId,
      projectId: built.project.id,
      organizationId: built.organizationId,
      partnerEmail,
      bundle: {
        id: bundleId,
        projectId: built.project.id,
        organizationId: built.organizationId,
        partnerEmail,
        packageName: built.packageName,
        format: 'ZIP',
        fileSizeBytes: buffer.length,
        screensIncluded: built.summary.screensIncluded,
        programsIncluded: built.summary.programsIncluded,
        excludedItems: built.summary.excludedItems,
        customNotes,
        storageReference,
        exportedAt: new Date(),
        exportedBy: userId,
        notificationStatus: 'PENDING',
      },
    });

    return this.toView(await this.notify(record, built.summary.projectName, built.summary.targetFramework));
  }

  /** Re-sends the notification of an already published bundle. */
  async retryNotification(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    bundleId: string,
  ): Promise<ExportBundleView> {
    const { record, project } = await this.requireBundle(userId, organizationHeader, projectId, bundleId);
    const targetFramework = record.programsIncluded > 0 ? 'Spring Boot 3.3' : 'React 19';
    return this.toView(await this.notify(record, project.name, targetFramework));
  }

  async list(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
  ): Promise<ExportBundleView[]> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const project = await this.projects.getForOrganization(projectId, organization.id);
    const records = await this.bundles.listByProject(project.id, organization.id);
    return records.map((r) => this.toView(r));
  }

  async download(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    bundleId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { record } = await this.requireBundle(userId, organizationHeader, projectId, bundleId);
    let files: { relativePath: string; content: Buffer }[];
    try {
      files = await this.storage.readFiles(record.storageReference);
    } catch (error) {
      this.logger.error(`Stored ZIP of bundle ${record.id} could not be read: ${(error as Error).message}`);
      files = [];
    }
    const zip = files.find((f) => f.relativePath === record.packageName) ?? files[0];
    if (!zip) {
      throw new NotFoundException({
        code: 'EXPORT_BUNDLE_FILE_MISSING',
        message: 'The ZIP file of this bundle is no longer available. Publish the project again.',
      });
    }
    return { buffer: zip.content, filename: record.packageName };
  }

  private async notify(
    record: ExportBundleRecord,
    projectName: string,
    targetFramework: string,
  ): Promise<ExportBundleRecord> {
    let update: { status: 'SENT' | 'FAILED'; error?: string; notifiedAt?: Date };
    try {
      const delivered = await this.mail.sendPartnerExportNotification({
        to: record.partnerEmail,
        projectName,
        packageName: record.packageName,
        targetFramework,
        includedCount: record.screensIncluded + record.programsIncluded,
        excludedItems: record.excludedItems,
        customNotes: record.customNotes,
        portalUrl: this.portalUrl(),
      });
      update = delivered
        ? { status: 'SENT', notifiedAt: new Date() }
        : { status: 'FAILED', error: SMTP_NOT_CONFIGURED };
    } catch (error) {
      this.logger.error(
        `Export notification for bundle ${record.id} to ${record.partnerEmail} failed: ${(error as Error).message}`,
      );
      update = { status: 'FAILED', error: DELIVERY_FAILED };
    }

    try {
      const saved = await this.bundles.updateNotification(record.id, record.organizationId, update);
      if (saved) return saved;
    } catch (error) {
      this.logger.error(
        `Could not record notification status ${update.status} for bundle ${record.id}: ${(error as Error).message}`,
      );
    }
    return {
      ...record,
      notificationStatus: update.status,
      notificationError: update.error,
      notifiedAt: update.notifiedAt,
    };
  }

  private async requireBundle(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    bundleId: string,
  ) {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const project = await this.projects.getForOrganization(projectId, organization.id);
    const record = await this.bundles.findById(bundleId, organization.id);
    if (!record || record.projectId !== project.id) {
      throw new NotFoundException({
        code: 'EXPORT_BUNDLE_NOT_FOUND',
        message: 'Export bundle was not found',
      });
    }
    return { record, project };
  }

  private portalUrl(): string {
    const base =
      this.config.get<string>('PARTNER_PORTAL_URL') ||
      this.config.get<string>('APP_BASE_URL') ||
      'http://localhost:5173';
    return `${base.replace(/\/+$/, '')}/portal/downloads`;
  }

  private toView(record: ExportBundleRecord): ExportBundleView {
    const view: Partial<ExportBundleRecord> = { ...record };
    delete view.storageReference;
    return view as ExportBundleView;
  }
}
