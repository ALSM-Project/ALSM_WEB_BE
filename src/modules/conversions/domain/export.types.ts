export type ExportOutputOption = 'scaffold' | 'standalone' | 'storybook';
export type FrameworkTarget = 'react-19' | 'react-18';
export type StylingOption = 'tailwind' | 'css-modules';

export interface ExportFileItem {
  path: string;
  name: string;
  size: string;
  type: 'file' | 'dir';
  language?: 'typescript' | 'javascript' | 'json' | 'markdown' | 'html' | 'css' | 'java';
  content?: string;
  children?: ExportFileItem[];
}

export interface ExportConfiguration {
  projectId: string;
  projectName?: string;
  outputOption: ExportOutputOption;
  frameworkTarget: FrameworkTarget;
  stylingOption: StylingOption;
  includeTypeScriptStrict: boolean;
  includeUnitTests: boolean;
  includeStorybook: boolean;
  includeDocumentation: boolean;
  selectedScreenIds: string[];
}

export interface BundleMetrics {
  totalFiles: number;
  totalLoc: number;
  estimatedSizeKb: number;
  selectedScreensCount: number;
}

/** UC-48: options a Conversion Staff member picks when packaging a partner project. */
export interface PartnerExportConfiguration {
  projectId: string;
  projectName?: string;
  /** Screens/programs to package; an empty list means every item of the project. */
  selectedScreenIds: string[];
  includeTypeScript: boolean;
  includeUnitTests: boolean;
  includeDocumentation: boolean;
  customNotes?: string;
}

export type ExportBundleFormat = 'ZIP';
export type ExportNotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface ExcludedExportItem {
  name: string;
  reason: string;
}

/** What went into (and was left out of) a partner bundle, before anything is persisted. */
export interface PartnerBundleSummary {
  projectName: string;
  targetFramework: 'React 19' | 'Spring Boot 3.3';
  screensIncluded: number;
  programsIncluded: number;
  excludedItems: ExcludedExportItem[];
}

export interface ExportBundleRecord {
  id: string;
  projectId: string;
  organizationId: string;
  /** The UC-44 partner profile whose contact email received the bundle, when one matches. */
  partnerId?: string;
  partnerEmail: string;
  packageName: string;
  format: ExportBundleFormat;
  fileSizeBytes: number;
  screensIncluded: number;
  programsIncluded: number;
  excludedItems: ExcludedExportItem[];
  customNotes?: string;
  /** Internal storage reference of the ZIP; never returned to clients. */
  storageReference: string;
  exportedAt: Date;
  exportedBy: string;
  notificationStatus: ExportNotificationStatus;
  /** User-safe reason the last notification attempt did not go out. */
  notificationError?: string;
  notifiedAt?: Date;
  downloadUrl: string;
}

export type NewExportBundle = Omit<ExportBundleRecord, 'id' | 'downloadUrl'> & { id: string };

export interface ExportBundleRepository {
  findById(id: string, organizationId: string): Promise<ExportBundleRecord | null>;
  /** Newest first. */
  listByProject(projectId: string, organizationId: string): Promise<ExportBundleRecord[]>;
  updateNotification(
    id: string,
    organizationId: string,
    update: { status: ExportNotificationStatus; error?: string; notifiedAt?: Date },
  ): Promise<ExportBundleRecord | null>;
}

export const EXPORT_BUNDLE_REPOSITORY = Symbol('EXPORT_BUNDLE_REPOSITORY');

/** Everything that must change together when a bundle is released to a partner. */
export interface ExportPublication {
  bundle: NewExportBundle;
  actorUserId: string;
  projectId: string;
  organizationId: string;
  partnerEmail: string;
}

export interface ExportPublicationUnitOfWork {
  /**
   * Atomically marks the project exported, bumps the matching partner profile's export
   * counter, stores the bundle record and writes the audit entry. Either all of it is
   * committed or none of it is.
   */
  commit(publication: ExportPublication): Promise<ExportBundleRecord>;
}

export const EXPORT_PUBLICATION_UNIT_OF_WORK = Symbol('EXPORT_PUBLICATION_UNIT_OF_WORK');
