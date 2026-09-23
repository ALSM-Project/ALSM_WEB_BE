import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import * as path from 'path';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { ProjectService } from '../../projects/application/project.service';
import { ConversionType } from '../../projects/domain/project.types';
import { ScreenService } from '../../screens/application/screen.service';
import { ScreenRecord, ScreenSourceType } from '../../screens/domain/screen.types';
import { analyzeBundle } from '../domain/copybook-dependency-resolver';

export interface UploadedSourceFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface UploadConversionSourceResult {
  inputReference: string;
  files: { name: string; sizeBytes: number }[];
  screens: ScreenRecord[];
}

const ALLOWED_EXTENSIONS: Record<ConversionType, string[]> = {
  [ConversionType.BMS_DSPF_TO_FRONTEND]: ['.bms', '.dspf'],
  [ConversionType.COBOL_TO_JAVA]: ['.cob', '.cbl', '.cpy'],
};

/** Extensions that create a real Screen record — copybooks (.cpy) are supporting
 * files only, never a screen/program on their own. */
const SCREEN_SOURCE_TYPE_BY_EXTENSION: Record<string, ScreenSourceType> = {
  '.bms': ScreenSourceType.BMS,
  '.dspf': ScreenSourceType.DSPF,
  '.cob': ScreenSourceType.COBOL,
  '.cbl': ScreenSourceType.COBOL,
};

@Injectable()
export class UploadConversionSourceService {
  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    private readonly projects: ProjectService,
    private readonly screenService: ScreenService,
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

    // Files are stored flat by basename (see storage.writeFiles below), so two different local
    // files sharing a basename (e.g. picked from two different subfolders) would silently
    // overwrite one another on disk — and any dependency analysis run against the original
    // upload list would then disagree with what actually landed in storage. Reject up front
    // instead of guessing which one should "win".
    const namesSeen = new Map<string, string>();
    for (const file of files) {
      const key = file.originalname.toLowerCase();
      if (namesSeen.has(key)) {
        throw new BadRequestException({
          code: 'DUPLICATE_FILE_NAME',
          message: `Two different files named "${file.originalname}" were selected in this upload (likely from two different subfolders). Remove the duplicate and try again — files are stored by name only, so both would otherwise silently collide.`,
        });
      }
      namesSeen.set(key, file.originalname);
    }

    const inputReference = await this.storage.writeFiles(
      `sources/${project.id}`,
      files.map((file) => ({ relativePath: file.originalname, content: file.buffer })),
    );

    // Copybooks (.cpy) are supporting files only — they never become a screen of
    // their own, but they do share this same inputReference bundle so the COBOL
    // adapter can still resolve COPY statements against them later.
    const screens: ScreenRecord[] = [];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const sourceType = SCREEN_SOURCE_TYPE_BY_EXTENSION[ext];
      if (!sourceType) continue;
      screens.push(
        await this.screenService.create(organization.id, project.id, userId, {
          name: file.originalname,
          sourceType,
          inputReference,
          sizeBytes: file.size,
        }),
      );
    }

    // Copybook Dependency Resolver: one static-analysis pass over the whole bundle (builds
    // its file index once), run only for COBOL projects, right after screens exist so each
    // program's analysis can be persisted onto its own screen immediately.
    if (project.conversionType === ConversionType.COBOL_TO_JAVA) {
      const analysis = analyzeBundle(files.map((file) => ({ name: file.originalname, content: file.buffer.toString('utf8') })));
      const analyzedAt = new Date();
      for (const screen of screens) {
        const programAnalysis = analysis.get(screen.name);
        if (!programAnalysis) continue;
        await this.screenService.recordDependencyDiagnostics(organization.id, screen.id, {
          status: programAnalysis.status,
          dependencies: programAnalysis.dependencies,
          analyzedAt,
        });
        screen.dependencyStatus = programAnalysis.status;
        screen.dependencies = programAnalysis.dependencies;
        screen.dependencyAnalyzedAt = analyzedAt;
      }
    }

    return {
      inputReference,
      files: files.map((file) => ({ name: file.originalname, sizeBytes: file.size })),
      screens,
    };
  }
}
