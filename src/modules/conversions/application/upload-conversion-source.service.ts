import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import * as path from 'path';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { ProjectService } from '../../projects/application/project.service';
import { ConversionType } from '../../projects/domain/project.types';

export interface UploadedSourceFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface UploadConversionSourceResult {
  inputReference: string;
  files: { name: string; sizeBytes: number }[];
}

const ALLOWED_EXTENSIONS: Record<ConversionType, string[]> = {
  [ConversionType.BMS_DSPF_TO_FRONTEND]: ['.bms', '.dspf'],
  [ConversionType.COBOL_TO_JAVA]: ['.cob', '.cbl', '.cpy'],
};

@Injectable()
export class UploadConversionSourceService {
  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    private readonly projects: ProjectService,
  ) {}

  async execute(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    files: UploadedSourceFile[],
  ): Promise<UploadConversionSourceResult> {
    if (!files || files.length === 0) {
      throw new BadRequestException({ code: 'NO_FILES_UPLOADED', message: 'At least one file is required' });
    }
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const project = await this.projects.getForOrganization(projectId, organization.id);
    const allowedExtensions = ALLOWED_EXTENSIONS[project.conversionType];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        throw new BadRequestException({
          code: 'UNSUPPORTED_SOURCE_FILE_TYPE',
          message: `File "${file.originalname}" has unsupported extension "${ext}" for this project's conversion type`,
        });
      }
    }

    const inputReference = await this.storage.writeFiles(
      `sources/${project.id}`,
      files.map((file) => ({ relativePath: file.originalname, content: file.buffer })),
    );
    return {
      inputReference,
      files: files.map((file) => ({ name: file.originalname, sizeBytes: file.size })),
    };
  }
}
