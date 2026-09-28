import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRecord,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../domain/conversion-job.types';
import {
  CONVERSION_QUALITY_REVIEW_REPOSITORY,
  ConversionQualityReviewRecord,
  ConversionQualityReviewRepository,
  ConversionQualityReviewStatus,
} from '../domain/conversion-quality-review.types';

export interface ConversionQualityReviewResponse {
  review: ConversionQualityReviewRecord;
  fileSummary: {
    fileCount: number;
    totalLines: number;
    toolVersion?: string;
  };
}

@Injectable()
export class GetConversionQualityReviewService {
  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(CONVERSION_QUALITY_REVIEW_REPOSITORY)
    private readonly qualityReviews: ConversionQualityReviewRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly organizationContext: OrganizationContextService,
  ) {}

  async execute(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    conversionJobId: string,
  ): Promise<ConversionQualityReviewResponse> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);

    const job = await this.jobs.findById(conversionJobId, organization.id);
    if (!job || job.projectId !== projectId) {
      throw new NotFoundException({
        code: 'CONVERSION_JOB_NOT_FOUND',
        message: 'Conversion job was not found',
      });
    }

    if (job.status !== ConversionJobStatus.COMPLETED) {
      throw new BadRequestException({
        code: 'CONVERSION_NOT_COMPLETED',
        message: 'Conversion job has not completed successfully yet',
      });
    }

    const existingReview = await this.qualityReviews.findByConversionJob(
      conversionJobId,
      projectId,
      organization.id,
    );

    // Synthetic PENDING record for jobs with no review yet
    const review: ConversionQualityReviewRecord = existingReview ?? this.syntheticPending(job);

    const fileSummary = await this.buildFileSummary(job);

    return { review, fileSummary };
  }

  private syntheticPending(job: ConversionJobRecord): ConversionQualityReviewRecord {
    const now = new Date();
    return {
      id: '',
      organizationId: job.organizationId,
      projectId: job.projectId,
      conversionJobId: job.id,
      screenId: job.screenId,
      status: ConversionQualityReviewStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async buildFileSummary(
    job: ConversionJobRecord,
  ): Promise<{ fileCount: number; totalLines: number; toolVersion?: string }> {
    if (!job.resultReference) {
      return { fileCount: 0, totalLines: 0, toolVersion: job.toolVersion };
    }
    try {
      const files = await this.storage.readFiles(job.resultReference);
      const totalLines = files.reduce(
        (sum, f) => sum + f.content.toString('utf8').split('\n').length,
        0,
      );
      return { fileCount: files.length, totalLines, toolVersion: job.toolVersion };
    } catch {
      return { fileCount: 0, totalLines: 0, toolVersion: job.toolVersion };
    }
  }
}
