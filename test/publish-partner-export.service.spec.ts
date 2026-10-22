import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PublishPartnerExportService } from '../src/modules/conversions/application/publish-partner-export.service';
import type { ExportBundleRecord, ExportPublication } from '../src/modules/conversions/domain/export.types';

const ORG = '6650cc00cc00cc00cc00cc01';
const PROJECT = '6650aa00aa00aa00aa00aa01';
const STAFF = '6650dd00dd00dd00dd00dd01';

const OPTIONS = {
  selectedScreenIds: [],
  includeTypeScript: true,
  includeUnitTests: true,
  includeDocumentation: true,
};

function builtBundle(included = 2) {
  return {
    project: { id: PROJECT, name: 'Core Banking Screens' },
    organizationId: ORG,
    packageName: 'core-banking-screens-modernized-bundle-v1.zip',
    summary: {
      projectName: 'Core Banking Screens',
      targetFramework: 'React 19' as const,
      screensIncluded: included,
      programsIncluded: 0,
      excludedItems: [{ name: 'MENU.bms', reason: 'Conversion failed' }],
    },
    metrics: { totalFiles: 10, totalLoc: 100, estimatedSizeKb: 4 },
    fileTree: [],
  };
}

describe('PublishPartnerExportService (UC-48)', () => {
  const bundleBuilder = { build: jest.fn(), assertHasContent: jest.fn(), zip: jest.fn() };
  const storage = { writeFiles: jest.fn(), readFiles: jest.fn(), resolvePath: jest.fn() };
  const publication = { commit: jest.fn() };
  const bundles = { findById: jest.fn(), listByProject: jest.fn(), updateNotification: jest.fn() };
  const mail = { sendPartnerExportNotification: jest.fn() };
  const config = { get: jest.fn() };
  const organizationContext = { resolve: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  let service: PublishPartnerExportService;

  beforeEach(() => {
    jest.clearAllMocks();
    bundleBuilder.build.mockResolvedValue(builtBundle());
    bundleBuilder.assertHasContent.mockImplementation(() => undefined);
    bundleBuilder.zip.mockResolvedValue(Buffer.from('PK-zip-bytes'));
    storage.writeFiles.mockResolvedValue('exports/org/project/bundle');
    publication.commit.mockImplementation(
      async (p: ExportPublication): Promise<ExportBundleRecord> => ({
        ...p.bundle,
        downloadUrl: `/projects/${PROJECT}/partner-export/bundles/${p.bundle.id}/download`,
      }),
    );
    bundles.updateNotification.mockImplementation(async (id: string, _org: string, update) => ({
      ...(publication.commit.mock.results[0] ? await publication.commit.mock.results[0].value : {}),
      id,
      notificationStatus: update.status,
      notificationError: update.error,
      notifiedAt: update.notifiedAt,
    }));
    mail.sendPartnerExportNotification.mockResolvedValue(true);
    config.get.mockImplementation((key: string) =>
      key === 'PARTNER_PORTAL_URL' ? 'https://portal.alsm.io/' : undefined,
    );
    organizationContext.resolve.mockResolvedValue({ id: ORG });
    projects.getForOrganization.mockResolvedValue({ id: PROJECT, name: 'Core Banking Screens' });
    service = new PublishPartnerExportService(
      bundleBuilder as never,
      storage as never,
      publication as never,
      bundles as never,
      mail as never,
      config as never,
      organizationContext as never,
      projects as never,
    );
  });

  it('stores the ZIP, commits the release once and reports the email as SENT', async () => {
    const result = await service.publish(STAFF, undefined, PROJECT, {
      partnerEmail: '  JReynolds@PacificBanking.com ',
      customNotes: '  Use the staging API first. ',
      options: OPTIONS,
    });

    expect(storage.writeFiles).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^org/${ORG}/project/${PROJECT}/exports/[0-9a-f]{24}$`)),
      [{ relativePath: 'core-banking-screens-modernized-bundle-v1.zip', content: Buffer.from('PK-zip-bytes') }],
    );
    expect(publication.commit).toHaveBeenCalledTimes(1);
    const committed = publication.commit.mock.calls[0][0] as ExportPublication;
    expect(committed).toMatchObject({
      actorUserId: STAFF,
      projectId: PROJECT,
      organizationId: ORG,
      partnerEmail: 'jreynolds@pacificbanking.com',
      bundle: {
        format: 'ZIP',
        fileSizeBytes: Buffer.from('PK-zip-bytes').length,
        screensIncluded: 2,
        programsIncluded: 0,
        excludedItems: [{ name: 'MENU.bms', reason: 'Conversion failed' }],
        customNotes: 'Use the staging API first.',
        storageReference: 'exports/org/project/bundle',
        exportedBy: STAFF,
        notificationStatus: 'PENDING',
      },
    });

    expect(mail.sendPartnerExportNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jreynolds@pacificbanking.com',
        projectName: 'Core Banking Screens',
        packageName: 'core-banking-screens-modernized-bundle-v1.zip',
        includedCount: 2,
        customNotes: 'Use the staging API first.',
        portalUrl: 'https://portal.alsm.io/portal/downloads',
      }),
    );
    expect(result.notificationStatus).toBe('SENT');
    expect(result).not.toHaveProperty('storageReference');
  });

  it('keeps the release when the email fails: FAILED status, nothing rolled back', async () => {
    mail.sendPartnerExportNotification.mockRejectedValue(new Error('535 Authentication failed'));

    const result = await service.publish(STAFF, undefined, PROJECT, {
      partnerEmail: 'jreynolds@pacificbanking.com',
      options: OPTIONS,
    });

    expect(publication.commit).toHaveBeenCalledTimes(1);
    expect(result.notificationStatus).toBe('FAILED');
    expect(result.notificationError).toMatch(/could not be delivered/i);
    expect(result.notificationError).not.toContain('535');
    expect(bundles.updateNotification).toHaveBeenCalledWith(expect.any(String), ORG, {
      status: 'FAILED',
      error: expect.any(String),
    });
  });

  it('does not claim SENT when SMTP is not configured', async () => {
    mail.sendPartnerExportNotification.mockResolvedValue(false);

    const result = await service.publish(STAFF, undefined, PROJECT, {
      partnerEmail: 'jreynolds@pacificbanking.com',
      options: OPTIONS,
    });

    expect(result.notificationStatus).toBe('FAILED');
    expect(result.notificationError).toMatch(/not configured/i);
  });

  it('still answers with the real status when saving the notification status fails', async () => {
    bundles.updateNotification.mockRejectedValue(new Error('mongo down'));

    const result = await service.publish(STAFF, undefined, PROJECT, {
      partnerEmail: 'jreynolds@pacificbanking.com',
      options: OPTIONS,
    });

    expect(result.notificationStatus).toBe('SENT');
  });

  it('refuses an empty bundle before storing or committing anything', async () => {
    bundleBuilder.build.mockResolvedValue(builtBundle(0));
    bundleBuilder.assertHasContent.mockImplementation(() => {
      throw new UnprocessableEntityException({ code: 'NO_COMPLETED_ITEMS' });
    });

    await expect(
      service.publish(STAFF, undefined, PROJECT, { partnerEmail: 'a@b.io', options: OPTIONS }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(storage.writeFiles).not.toHaveBeenCalled();
    expect(publication.commit).not.toHaveBeenCalled();
    expect(mail.sendPartnerExportNotification).not.toHaveBeenCalled();
  });

  it('never emails the partner when the release transaction fails', async () => {
    publication.commit.mockRejectedValue(new Error('ATOMIC_MUTATION_ABORTED'));

    await expect(
      service.publish(STAFF, undefined, PROJECT, { partnerEmail: 'a@b.io', options: OPTIONS }),
    ).rejects.toThrow('ATOMIC_MUTATION_ABORTED');
    expect(mail.sendPartnerExportNotification).not.toHaveBeenCalled();
  });

  describe('released bundles', () => {
    const record: ExportBundleRecord = {
      id: '6650ee00ee00ee00ee00ee01',
      projectId: PROJECT,
      organizationId: ORG,
      partnerEmail: 'jreynolds@pacificbanking.com',
      packageName: 'core-banking-screens-modernized-bundle-v1.zip',
      format: 'ZIP',
      fileSizeBytes: 12,
      screensIncluded: 2,
      programsIncluded: 0,
      excludedItems: [],
      storageReference: 'exports/secret/location',
      exportedAt: new Date('2026-10-22'),
      exportedBy: STAFF,
      notificationStatus: 'FAILED',
      notificationError: 'x',
      downloadUrl: '/projects/p/partner-export/bundles/b/download',
    };

    it('retries the notification of a FAILED bundle', async () => {
      bundles.findById.mockResolvedValue(record);
      bundles.updateNotification.mockResolvedValue({ ...record, notificationStatus: 'SENT' });

      const result = await service.retryNotification(STAFF, undefined, PROJECT, record.id);

      expect(mail.sendPartnerExportNotification).toHaveBeenCalledTimes(1);
      expect(result.notificationStatus).toBe('SENT');
      expect(result).not.toHaveProperty('storageReference');
    });

    it('returns 404 for a bundle of another project', async () => {
      bundles.findById.mockResolvedValue({ ...record, projectId: 'another-project' });
      await expect(service.retryNotification(STAFF, undefined, PROJECT, record.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mail.sendPartnerExportNotification).not.toHaveBeenCalled();
    });

    it('streams the stored ZIP, or a safe 404 when the file is gone', async () => {
      bundles.findById.mockResolvedValue(record);
      storage.readFiles.mockResolvedValue([
        { relativePath: record.packageName, content: Buffer.from('PK') },
      ]);
      await expect(service.download(STAFF, undefined, PROJECT, record.id)).resolves.toEqual({
        buffer: Buffer.from('PK'),
        filename: record.packageName,
      });

      storage.readFiles.mockRejectedValue(new Error("ENOENT 'D:\\ALSM\\storage\\exports'"));
      const error = await service.download(STAFF, undefined, PROJECT, record.id).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(JSON.stringify((error as NotFoundException).getResponse())).not.toContain('ALSM');
    });

    it('lists bundles without their storage reference', async () => {
      bundles.listByProject.mockResolvedValue([record]);
      const list = await service.list(STAFF, undefined, PROJECT);
      expect(list).toHaveLength(1);
      expect(list[0]).not.toHaveProperty('storageReference');
    });
  });
});
