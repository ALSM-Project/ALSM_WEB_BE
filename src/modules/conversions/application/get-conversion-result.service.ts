import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProjectService } from '../../projects/application/project.service';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../domain/conversion-job.types';
import { ConversionResultBundle } from '../domain/conversion-result.types';
import { ConversionProjectAccessService } from './conversion-project-access.service';

@Injectable()
export class GetConversionResultService {
  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly organizationContext: OrganizationContextService,
    private readonly projects: ProjectService,
    private readonly access: ConversionProjectAccessService,
  ) {}

  async execute(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ConversionResultBundle> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const job = await this.jobs.findById(id, organization.id);
    if (!job) {
      throw new NotFoundException({
        code: 'CONVERSION_JOB_NOT_FOUND',
        message: 'Conversion job was not found',
      });
    }
    await this.access.requireAssignment(userId, organization.id, job.projectId);
    await this.projects.getForOrganization(job.projectId, organization.id);
    if (job.status !== ConversionJobStatus.COMPLETED || !job.resultReference) {
      throw new BadRequestException({
        code: 'CONVERSION_RESULT_NOT_READY',
        message: 'Conversion job has not completed successfully yet',
      });
    }
    let files;
    try {
      files = await this.storage.readFiles(job.resultReference);
      if (files.length === 0) throw new Error('Missing conversion result');
    } catch {
      throw new ServiceUnavailableException({
        code: 'CONVERSION_RESULT_UNAVAILABLE',
        message: 'Conversion result files are unavailable',
      });
    }
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
