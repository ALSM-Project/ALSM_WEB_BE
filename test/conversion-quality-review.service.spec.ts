import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import {
  ConversionJobRecord,
  ConversionJobRepository,
  ConversionJobStatus,
  ConversionPriority,
} from '../src/modules/conversions/domain/conversion-job.types';
import {
  ConversionQualityReviewRecord,
  ConversionQualityReviewRepository,
  ConversionQualityReviewStatus,
} from '../src/modules/conversions/domain/conversion-quality-review.types';
import { GetConversionQualityReviewService } from '../src/modules/conversions/application/get-conversion-quality-review.service';
import { SubmitConversionQualityReviewService } from '../src/modules/conversions/application/submit-conversion-quality-review.service';
import { StoragePort } from '../src/shared/storage/storage.port';

describe('Conversion Quality Review Services', () => {
  const org = { id: 'org-1', name: 'Test Org', members: [] };
  const mockCompletedJob: ConversionJobRecord = {
    id: 'job-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    screenId: 'screen-1',
    conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
    status: ConversionJobStatus.COMPLETED,
    priority: ConversionPriority.NORMAL,
    attemptCount: 1,
    maxAttempts: 3,
    resultReference: 'conversions/job-1',
    toolVersion: '1.2.0',
    createdBy: 'user-1',
    createdAt: new Date('2026-09-26T10:00:00.000Z'),
    updatedAt: new Date('2026-09-26T10:05:00.000Z'),
  };

  const mockProcessingJob: ConversionJobRecord = {
    ...mockCompletedJob,
    id: 'job-processing',
    status: ConversionJobStatus.PROCESSING,
  };

  const existingReview: ConversionQualityReviewRecord = {
    id: 'rev-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'job-1',
    screenId: 'screen-1',
    status: ConversionQualityReviewStatus.ACCEPTED,
    qualityScore: 5,
    reviewNote: 'Looks great',
    reviewedBy: 'user-1',
    reviewedAt: new Date('2026-09-26T11:00:00.000Z'),
    createdAt: new Date('2026-09-26T11:00:00.000Z'),
    updatedAt: new Date('2026-09-26T11:00:00.000Z'),
  };

  describe('GetConversionQualityReviewService', () => {
    let jobsRepo: jest.Mocked<ConversionJobRepository>;
    let qualityRepo: jest.Mocked<ConversionQualityReviewRepository>;
    let storage: jest.Mocked<StoragePort>;
    let orgContext: jest.Mocked<OrganizationContextService>;
    let service: GetConversionQualityReviewService;

    beforeEach(() => {
      jobsRepo = {
        findById: jest.fn(),
        create: jest.fn(),
        updateStatus: jest.fn(),
        listByProject: jest.fn(),
        listByScreen: jest.fn(),
      } as unknown as jest.Mocked<ConversionJobRepository>;

      qualityRepo = {
        findByConversionJob: jest.fn(),
        upsert: jest.fn(),
      } as unknown as jest.Mocked<ConversionQualityReviewRepository>;

      storage = {
        readFiles: jest.fn().mockResolvedValue([
          { path: 'Screen.java', content: Buffer.from('public class Screen {\n  int a;\n}') },
        ]),
        saveFiles: jest.fn(),
        deleteFiles: jest.fn(),
      } as unknown as jest.Mocked<StoragePort>;

      orgContext = {
        resolve: jest.fn().mockResolvedValue(org),
      } as unknown as jest.Mocked<OrganizationContextService>;

      service = new GetConversionQualityReviewService(
        jobsRepo,
        qualityRepo,
        storage,
        orgContext,
      );
    });

    it('Case 1: GET returns synthetic PENDING record when no review exists yet', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);
      qualityRepo.findByConversionJob.mockResolvedValue(null);

      const result = await service.execute('user-1', undefined, 'project-1', 'job-1');

      expect(result.review.status).toBe(ConversionQualityReviewStatus.PENDING);
      expect(result.review.conversionJobId).toBe('job-1');
      expect(result.fileSummary.fileCount).toBe(1);
      expect(result.fileSummary.totalLines).toBe(3);
      expect(result.fileSummary.toolVersion).toBe('1.2.0');
    });

    it('Case 2: GET returns existing record when already reviewed', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);
      qualityRepo.findByConversionJob.mockResolvedValue(existingReview);

      const result = await service.execute('user-1', undefined, 'project-1', 'job-1');

      expect(result.review.status).toBe(ConversionQualityReviewStatus.ACCEPTED);
      expect(result.review.id).toBe('rev-1');
      expect(result.review.qualityScore).toBe(5);
    });

    it('Case 3: GET throws 400 CONVERSION_NOT_COMPLETED if job is not completed', async () => {
      jobsRepo.findById.mockResolvedValue(mockProcessingJob);

      await expect(
        service.execute('user-1', undefined, 'project-1', 'job-processing'),
      ).rejects.toThrow(BadRequestException);
    });

    it('Case 4: GET throws 404 CONVERSION_JOB_NOT_FOUND if job does not exist or wrong project', async () => {
      jobsRepo.findById.mockResolvedValue(null);

      await expect(
        service.execute('user-1', undefined, 'project-1', 'job-not-found'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('SubmitConversionQualityReviewService', () => {
    let jobsRepo: jest.Mocked<ConversionJobRepository>;
    let qualityRepo: jest.Mocked<ConversionQualityReviewRepository>;
    let orgContext: jest.Mocked<OrganizationContextService>;
    let authorization: jest.Mocked<OrganizationAuthorizationService>;
    let projects: jest.Mocked<ProjectService>;
    let audit: jest.Mocked<AuditRepository>;
    let service: SubmitConversionQualityReviewService;

    beforeEach(() => {
      jobsRepo = {
        findById: jest.fn(),
        create: jest.fn(),
        updateStatus: jest.fn(),
        listByProject: jest.fn(),
        listByScreen: jest.fn(),
      } as unknown as jest.Mocked<ConversionJobRepository>;

      qualityRepo = {
        findByConversionJob: jest.fn(),
        upsert: jest.fn(),
      } as unknown as jest.Mocked<ConversionQualityReviewRepository>;

      orgContext = {
        resolve: jest.fn().mockResolvedValue(org),
      } as unknown as jest.Mocked<OrganizationContextService>;

      authorization = {
        require: jest.fn(),
      } as unknown as jest.Mocked<OrganizationAuthorizationService>;

      projects = {
        getForOrganization: jest.fn().mockResolvedValue({ id: 'project-1' }),
      } as unknown as jest.Mocked<ProjectService>;

      audit = {
        append: jest.fn().mockResolvedValue(undefined),
      } as unknown as jest.Mocked<AuditRepository>;

      service = new SubmitConversionQualityReviewService(
        jobsRepo,
        qualityRepo,
        orgContext,
        authorization,
        projects,
        audit,
      );
    });

    it('Case 5: PATCH throws 403 for VIEWER role', async () => {
      authorization.require.mockImplementation(() => {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Insufficient role' });
      });

      await expect(
        service.execute({
          userId: 'viewer-user',
          organizationHeader: undefined,
          projectId: 'project-1',
          conversionJobId: 'job-1',
          status: 'ACCEPTED',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Case 6: PATCH PENDING -> ACCEPTED without note succeeds', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);
      qualityRepo.findByConversionJob.mockResolvedValue(null);
      qualityRepo.upsert.mockResolvedValue({
        outcome: 'CREATED',
        record: {
          ...existingReview,
          status: ConversionQualityReviewStatus.ACCEPTED,
          reviewNote: undefined,
          qualityScore: 4,
        },
      });

      const res = await service.execute({
        userId: 'user-1',
        organizationHeader: undefined,
        projectId: 'project-1',
        conversionJobId: 'job-1',
        status: 'ACCEPTED',
        qualityScore: 4,
      });

      expect(res.status).toBe(ConversionQualityReviewStatus.ACCEPTED);
      expect(qualityRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ConversionQualityReviewStatus.ACCEPTED,
          expectedStatus: ConversionQualityReviewStatus.PENDING,
          qualityScore: 4,
        }),
      );
    });

    it('Case 7: PATCH PENDING -> NEEDS_REWORK with note succeeds', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);
      qualityRepo.findByConversionJob.mockResolvedValue(null);
      qualityRepo.upsert.mockResolvedValue({
        outcome: 'CREATED',
        record: {
          ...existingReview,
          status: ConversionQualityReviewStatus.NEEDS_REWORK,
          reviewNote: 'Fix variable naming',
        },
      });

      const res = await service.execute({
        userId: 'user-1',
        organizationHeader: undefined,
        projectId: 'project-1',
        conversionJobId: 'job-1',
        status: 'NEEDS_REWORK',
        reviewNote: 'Fix variable naming',
      });

      expect(res.status).toBe(ConversionQualityReviewStatus.NEEDS_REWORK);
    });

    it('Case 8: PATCH PENDING -> NEEDS_REWORK without note throws 400 QUALITY_REVIEW_NOTE_REQUIRED', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);

      await expect(
        service.execute({
          userId: 'user-1',
          organizationHeader: undefined,
          projectId: 'project-1',
          conversionJobId: 'job-1',
          status: 'NEEDS_REWORK',
          reviewNote: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Case 9: PATCH PENDING -> FLAGGED without note throws 400 QUALITY_REVIEW_NOTE_REQUIRED', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);

      await expect(
        service.execute({
          userId: 'user-1',
          organizationHeader: undefined,
          projectId: 'project-1',
          conversionJobId: 'job-1',
          status: 'FLAGGED',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Case 10: PATCH with note > 2000 chars throws 400 QUALITY_REVIEW_NOTE_TOO_LONG', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);

      await expect(
        service.execute({
          userId: 'user-1',
          organizationHeader: undefined,
          projectId: 'project-1',
          conversionJobId: 'job-1',
          status: 'ACCEPTED',
          reviewNote: 'x'.repeat(2001),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Case 11: PATCH with invalid qualityScore throws 400 QUALITY_SCORE_INVALID', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);

      await expect(
        service.execute({
          userId: 'user-1',
          organizationHeader: undefined,
          projectId: 'project-1',
          conversionJobId: 'job-1',
          status: 'ACCEPTED',
          qualityScore: 6,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Case 12: PATCH handles concurrent modification and throws 409 ConflictException', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);
      qualityRepo.findByConversionJob.mockResolvedValue(null);
      qualityRepo.upsert.mockResolvedValue({
        outcome: 'CONFLICT',
        record: existingReview,
      });

      await expect(
        service.execute({
          userId: 'user-1',
          organizationHeader: undefined,
          projectId: 'project-1',
          conversionJobId: 'job-1',
          status: 'ACCEPTED',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('Case 13: PATCH writes audit log on success without logging raw note text', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);
      qualityRepo.findByConversionJob.mockResolvedValue(null);
      qualityRepo.upsert.mockResolvedValue({
        outcome: 'CREATED',
        record: existingReview,
      });

      await service.execute({
        userId: 'user-1',
        organizationHeader: undefined,
        projectId: 'project-1',
        conversionJobId: 'job-1',
        status: 'ACCEPTED',
        reviewNote: 'Confidential review notes',
        qualityScore: 5,
      });

      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CONVERSION_QUALITY_REVIEW_SUBMITTED',
          metadata: expect.objectContaining({
            conversionJobId: 'job-1',
            newStatus: 'ACCEPTED',
            reviewNoteProvided: 'true',
          }),
        }),
      );
      // Ensure raw note is NOT in audit metadata
      const auditCall = audit.append.mock.calls[0][0];
      expect(JSON.stringify(auditCall.metadata)).not.toContain('Confidential review notes');
    });

    it('Case 14: PATCH re-review from ACCEPTED -> NEEDS_REWORK is allowed', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);
      qualityRepo.findByConversionJob.mockResolvedValue(existingReview);
      qualityRepo.upsert.mockResolvedValue({
        outcome: 'UPDATED',
        record: {
          ...existingReview,
          status: ConversionQualityReviewStatus.NEEDS_REWORK,
          reviewNote: 'Found some issues upon second inspection',
        },
      });

      const res = await service.execute({
        userId: 'user-1',
        organizationHeader: undefined,
        projectId: 'project-1',
        conversionJobId: 'job-1',
        status: 'NEEDS_REWORK',
        reviewNote: 'Found some issues upon second inspection',
      });

      expect(res.status).toBe(ConversionQualityReviewStatus.NEEDS_REWORK);
      expect(qualityRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedStatus: ConversionQualityReviewStatus.ACCEPTED,
        }),
      );
    });

    it('Case 15: PATCH with target PENDING throws 400 QUALITY_REVIEW_STATUS_INVALID', async () => {
      jobsRepo.findById.mockResolvedValue(mockCompletedJob);

      await expect(
        service.execute({
          userId: 'user-1',
          organizationHeader: undefined,
          projectId: 'project-1',
          conversionJobId: 'job-1',
          status: 'PENDING',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
