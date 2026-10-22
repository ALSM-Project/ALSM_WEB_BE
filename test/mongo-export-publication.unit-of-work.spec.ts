import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  MongoExportPublicationUnitOfWork,
  PARTNER_PROJECT_CODE_EXPORTED,
} from '../src/modules/conversions/infrastructure/mongo-export-publication.unit-of-work';
import type { ExportPublication } from '../src/modules/conversions/domain/export.types';
import { ProjectStatus } from '../src/modules/projects/domain/project.types';

const ORG = '6650cc00cc00cc00cc00cc01';
const PROJECT = '6650aa00aa00aa00aa00aa01';
const STAFF = '6650dd00dd00dd00dd00dd01';
const BUNDLE = '6650ee00ee00ee00ee00ee01';
const PARTNER = '6650ff00ff00ff00ff00ff01';

function exec<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('MongoExportPublicationUnitOfWork (UC-48)', () => {
  const connection = {
    db: { admin: () => ({ command: jest.fn().mockResolvedValue({ setName: 'rs0' }) }) },
    startSession: jest.fn().mockResolvedValue({
      withTransaction: (work: () => Promise<unknown>) => work(),
      endSession: jest.fn(),
    }),
  };
  const projects = { updateOne: jest.fn() };
  const partners = { findOneAndUpdate: jest.fn() };
  const bundles = { create: jest.fn() };
  const audit = { append: jest.fn() };
  const auditFactory = jest.fn(() => audit);
  let unitOfWork: MongoExportPublicationUnitOfWork;

  const publication: ExportPublication = {
    actorUserId: STAFF,
    projectId: PROJECT,
    organizationId: ORG,
    partnerEmail: 'jreynolds@pacificbanking.com',
    bundle: {
      id: BUNDLE,
      projectId: PROJECT,
      organizationId: ORG,
      partnerEmail: 'jreynolds@pacificbanking.com',
      packageName: 'core-banking-modernized-bundle-v1.zip',
      format: 'ZIP',
      fileSizeBytes: 2048,
      screensIncluded: 3,
      programsIncluded: 0,
      excludedItems: [{ name: 'MENU.bms', reason: 'Conversion failed' }],
      storageReference: 'exports/x',
      exportedAt: new Date('2026-10-22T10:00:00Z'),
      exportedBy: STAFF,
      notificationStatus: 'PENDING',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    projects.updateOne.mockReturnValue(exec({ matchedCount: 1 }));
    partners.findOneAndUpdate.mockReturnValue(exec({ _id: new Types.ObjectId(PARTNER) }));
    bundles.create.mockImplementation(async ([doc]: [Record<string, unknown>]) => [
      {
        ...doc,
        id: BUNDLE,
        projectId: doc.projectId,
        organizationId: doc.organizationId,
        exportedBy: doc.exportedBy,
      },
    ]);
    unitOfWork = new MongoExportPublicationUnitOfWork(
      connection as never,
      projects as never,
      partners as never,
      bundles as never,
      auditFactory as never,
    );
  });

  it('marks the project exported, bumps the partner counter, stores the bundle and audits - in one session', async () => {
    const record = await unitOfWork.commit(publication);

    const [projectFilter, projectUpdate, projectOptions] = projects.updateOne.mock.calls[0];
    expect(projectFilter._id.toHexString()).toBe(PROJECT);
    expect(projectUpdate.$set).toEqual({
      status: ProjectStatus.COMPLETED,
      isExported: true,
      exportedAt: publication.bundle.exportedAt,
      exportedBundleName: 'core-banking-modernized-bundle-v1.zip',
    });
    const transactionSession = projectOptions.session;
    expect(transactionSession).toBeDefined();

    expect(partners.findOneAndUpdate).toHaveBeenCalledWith(
      { contactEmail: 'jreynolds@pacificbanking.com' },
      {
        $inc: { completedExportCount: 1 },
        $set: { latestActivity: 'Exported core-banking-modernized-bundle-v1.zip' },
      },
      { session: transactionSession, new: true },
    );
    expect(bundles.create.mock.calls[0][1]).toEqual({ session: transactionSession });
    expect(auditFactory).toHaveBeenCalledWith(transactionSession, connection);
    expect(audit.append).toHaveBeenCalledWith({
      actorUserId: STAFF,
      organizationId: ORG,
      action: PARTNER_PROJECT_CODE_EXPORTED,
      resourceType: 'PROJECT',
      resourceId: PROJECT,
      metadata: {
        bundleId: BUNDLE,
        packageName: 'core-banking-modernized-bundle-v1.zip',
        partnerEmail: 'jreynolds@pacificbanking.com',
        screensIncluded: '3',
        programsIncluded: '0',
        excludedCount: '1',
      },
    });
    expect(record).toMatchObject({
      id: BUNDLE,
      partnerId: PARTNER,
      notificationStatus: 'PENDING',
      downloadUrl: `/projects/${PROJECT}/partner-export/bundles/${BUNDLE}/download`,
    });
  });

  it('still releases the bundle when no partner profile has that contact email', async () => {
    partners.findOneAndUpdate.mockReturnValue(exec(null));
    const record = await unitOfWork.commit(publication);
    expect(record.partnerId).toBeUndefined();
    expect(audit.append).toHaveBeenCalledTimes(1);
  });

  it('aborts with 404 and writes nothing else when the project was deleted meanwhile', async () => {
    projects.updateOne.mockReturnValue(exec({ matchedCount: 0 }));

    await expect(unitOfWork.commit(publication)).rejects.toBeInstanceOf(NotFoundException);
    expect(partners.findOneAndUpdate).not.toHaveBeenCalled();
    expect(bundles.create).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });
});
