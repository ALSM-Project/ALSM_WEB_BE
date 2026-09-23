import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../domain/conversion-job.types';
import { ConversionResultBundle } from '../domain/conversion-result.types';

@Injectable()
export class GetConversionResultService {
  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly organizationContext: OrganizationContextService,
  ) {}

  async execute(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ConversionResultBundle> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const job = await this.jobs.findById(id, organization.id);
    if (!job) {
      throw new NotFoundException({ code: 'CONVERSION_JOB_NOT_FOUND', message: 'Conversion job was not found' });
    }
    if (job.status !== ConversionJobStatus.COMPLETED || !job.resultReference) {
      throw new BadRequestException({
        code: 'CONVERSION_RESULT_NOT_READY',
        message: 'Conversion job has not completed successfully yet',
      });
    }
    const files = await this.storage.readFiles(job.resultReference);
    return {
      conversionJobId: job.id,
      toolVersion: job.toolVersion,
      files: files.map((file) => ({
        relativePath: file.relativePath,
        content: file.content.toString('utf8'),
      })),
    };
  }
}
