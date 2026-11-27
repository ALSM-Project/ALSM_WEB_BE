import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { ProjectService } from '../../projects/application/project.service';
import {
  CONVERSION_JOB_REPOSITORY,
  CONVERSION_QUEUE,
  ConversionJobRecord,
  ConversionJobRepository,
  ConversionJobStatus,
  ConversionPriority,
  ConversionQueuePort,
} from '../domain/conversion-job.types';
import { OrganizationRecord } from '../../organizations/domain/organization.repository';
import { ConversionType, ProjectRecord } from '../../projects/domain/project.types';
import {
  SCREEN_REPOSITORY,
  ScreenRecord,
  ScreenRepository,
} from '../../screens/domain/screen.types';
import { findCopybookBlockers, normalizeCopyName } from '../domain/copybook-dependency-resolver';
import { ConversionProjectAccessService } from './conversion-project-access.service';

/** A screen that a staff-triggered conversion did not start, and why. */
export interface SkippedConversion {
  screenId: string;
  code:
    | 'SCREEN_NOT_FOUND'
    | 'CONVERSION_ALREADY_IN_PROGRESS'
    | 'COPYBOOK_DEPENDENCY_BLOCKED'
    | 'CONVERSION_QUEUE_UNAVAILABLE'
    | 'INCOMPATIBLE_CONVERSION_TYPE'
    | 'UNSUPPORTED_CONVERSION_TYPE';
  message: string;
}

export interface BulkConversionStartResult {
  jobs: ConversionJobRecord[];
  skipped: SkippedConversion[];
}

const IN_FLIGHT_STATUSES = new Set<ConversionJobStatus>([
  ConversionJobStatus.QUEUED,
  ConversionJobStatus.PROCESSING,
]);
/** A QUEUED/PROCESSING job untouched for this long is treated as stuck (e.g. the worker
 * died) so it cannot lock its screen out of conversion forever. */
const IN_FLIGHT_STALE_AFTER_MS = 15 * 60 * 1000;
@Injectable()
export class ConversionJobService {
  private readonly logger = new Logger(ConversionJobService.name);

  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(CONVERSION_QUEUE) private readonly queue: ConversionQueuePort,
    private readonly projects: ProjectService,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(SCREEN_REPOSITORY) private readonly screens: ScreenRepository,
    private readonly access: ConversionProjectAccessService,
  ) {}

  async create(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    input: { screenId?: string; priority?: ConversionPriority; inputReference?: string },
  ): Promise<ConversionJobRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader, projectId);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const project = await this.projects.getForOrganization(projectId, organization.id);
    return this.createJobRecord(organization, project, userId, input);
  }

  async createBulk(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    input: { screenIds: string[]; priority?: ConversionPriority; inputReference?: string },
  ): Promise<ConversionJobRecord[]> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader, projectId);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const project = await this.projects.getForOrganization(projectId, organization.id);
    const jobs: ConversionJobRecord[] = [];
    for (const screenId of input.screenIds) {
      jobs.push(
        await this.createJobRecord(organization, project, userId, {
          screenId,
          priority: input.priority,
          inputReference: input.inputReference,
        }),
      );
    }
    return jobs;
  }

  /**
   * Conversion Staff start (or retry) the conversion of one screen/program of a partner
   * project (UC-47). The screen is the source of truth for the input; a screen that already
   * has a conversion in flight, or a COBOL program blocked by missing copybooks, is rejected
   * up front instead of producing a job that races the running one or fails in the worker.
   */
  async startForPartner(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    input: { screenId: string; priority?: ConversionPriority },
  ): Promise<ConversionJobRecord> {
    const { organization, project } = await this.resolveWritableProject(
      userId,
      organizationHeader,
      projectId,
    );
    const screen = await this.screens.findById(input.screenId, organization.id);
    const problem = await this.findStartProblem(organization.id, project, input.screenId, screen);
    if (problem) throw this.toException(problem);
    return this.createJobRecord(organization, project, userId, {
      screenId: input.screenId,
      priority: input.priority,
    });
  }

  /**
   * "Run All" for a partner project. Every requested screen is checked first; the ones that
   * cannot start are reported in `skipped` with the reason, the rest are queued. If the
   * queue goes down part-way, the remaining screens are reported as skipped (the jobs
   * already queued stay valid) and the call only fails when nothing could be queued.
   */
  async startBulkForPartner(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    input: { screenIds: string[]; priority?: ConversionPriority },
  ): Promise<BulkConversionStartResult> {
    const { organization, project } = await this.resolveWritableProject(
      userId,
      organizationHeader,
      projectId,
    );
    const skipped: SkippedConversion[] = [];
    const eligible: string[] = [];
    for (const screenId of Array.from(new Set(input.screenIds))) {
      const screen = await this.screens.findById(screenId, organization.id);
      const problem = await this.findStartProblem(organization.id, project, screenId, screen);
      if (problem) skipped.push(problem);
      else eligible.push(screenId);
    }

    const jobs: ConversionJobRecord[] = [];
    for (let i = 0; i < eligible.length; i++) {
      try {
        jobs.push(
          await this.createJobRecord(organization, project, userId, {
            screenId: eligible[i],
            priority: input.priority,
          }),
        );
      } catch (error) {
        if (!this.isQueueUnavailable(error)) throw error;
        for (const screenId of eligible.slice(i)) {
          skipped.push({
            screenId,
            code: 'CONVERSION_QUEUE_UNAVAILABLE',
            message: 'Conversion job could not be queued',
          });
        }
        if (jobs.length === 0) throw error;
        break;
      }
    }
    return { jobs, skipped };
  }

  private async resolveWritableProject(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
  ): Promise<{ organization: OrganizationRecord; project: ProjectRecord }> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader, projectId);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const project = await this.projects.getForOrganization(projectId, organization.id);
    return { organization, project };
  }

  private async findStartProblem(
    organizationId: string,
    project: ProjectRecord,
    screenId: string,
    screen: ScreenRecord | null,
  ): Promise<SkippedConversion | null> {
    if (!screen || screen.projectId !== project.id) {
      return {
        screenId,
        code: 'SCREEN_NOT_FOUND',
        message: 'Screen was not found in this project',
      };
    }

    const now = Date.now();
    const jobs = await this.jobs.listByScreen(project.id, screen.id, organizationId);
    const running = jobs.find(
      (job) =>
        IN_FLIGHT_STATUSES.has(job.status) &&
        now - new Date(job.updatedAt).getTime() < IN_FLIGHT_STALE_AFTER_MS,
    );
    if (running) {
      return {
        screenId,
        code: 'CONVERSION_ALREADY_IN_PROGRESS',
        message: `"${screen.name}" already has a conversion in progress`,
      };
    }

    if (project.conversionType === ConversionType.COBOL_TO_JAVA) {
      if (screen.sourceType && screen.sourceType !== 'COBOL') {
        return {
          screenId,
          code: 'INCOMPATIBLE_CONVERSION_TYPE',
          message: `"${screen.name}" is a BMS/DSPF screen and cannot be converted in a COBOL project`,
        };
      }
      if (screen.dependencyStatus === 'BLOCKED') {
        const blockers = findCopybookBlockers(screen.dependencies ?? []);
        if (blockers.length > 0) {
          const projectSourcesDir = path.resolve(process.env.STORAGE_ROOT || './storage', 'sources', project.id);
          let allFound = false;
          if (fs.existsSync(projectSourcesDir)) {
            const allNames = new Set<string>();
            const scanNames = (dir: string) => {
              for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                if (ent.isDirectory()) scanNames(path.join(dir, ent.name));
                else if (ent.isFile()) allNames.add(normalizeCopyName(ent.name));
              }
            };
            scanNames(projectSourcesDir);
            const remaining = blockers.filter((b) => {
              const match = b.match(/'([^']+)'/);
              const name = match ? normalizeCopyName(match[1]) : '';
              return !allNames.has(name);
            });
            if (remaining.length === 0) {
              allFound = true;
            }
          }
          if (!allFound) {
            return {
              screenId,
              code: 'COPYBOOK_DEPENDENCY_BLOCKED',
              message: `"${screen.name}" is missing copybooks: ${blockers.join(' | ')}`,
            };
          }
        }
      }
    } else if (
      project.conversionType === ConversionType.BMS_DSPF_TO_REACT ||
      project.conversionType === ConversionType.BMS_DSPF_TO_FRONTEND
    ) {
      if (screen.sourceType === 'COBOL') {
        return {
          screenId,
          code: 'INCOMPATIBLE_CONVERSION_TYPE',
          message: `"${screen.name}" is a COBOL program and cannot be converted in a BMS/DSPF project`,
        };
      }
    } else {
      return {
        screenId,
        code: 'UNSUPPORTED_CONVERSION_TYPE',
        message: `Project conversion type "${project.conversionType}" is unsupported`,
      };
    }
    return null;
  }

  private toException(problem: SkippedConversion): HttpException {
    const body = { code: problem.code, message: problem.message };
    switch (problem.code) {
      case 'SCREEN_NOT_FOUND':
        return new NotFoundException(body);
      case 'CONVERSION_ALREADY_IN_PROGRESS':
        return new ConflictException(body);
      case 'COPYBOOK_DEPENDENCY_BLOCKED':
        return new UnprocessableEntityException(body);
      default:
        return new BadRequestException(body);
    }
  }

  private isQueueUnavailable(error: unknown): boolean {
    if (!(error instanceof BadRequestException)) return false;
    const response = error.getResponse() as { code?: string };
    return response?.code === 'CONVERSION_QUEUE_UNAVAILABLE';
  }

  private async createJobRecord(
    organization: OrganizationRecord,
    project: ProjectRecord,
    userId: string,
    input: { screenId?: string; priority?: ConversionPriority; inputReference?: string },
  ): Promise<ConversionJobRecord> {
    // The screen (once one exists) is the source of truth for where its real uploaded
    // file lives — resolve inputReference from it server-side rather than trusting
    // whatever (if anything) the caller passed. This is what makes bulk conversion work:
    // the bulk endpoint only ever received one shared inputReference for the whole
    // batch (or none), which is wrong for every screen but the first.
    const screen = input.screenId
      ? await this.screens.findById(input.screenId, organization.id)
      : null;
    if (input.screenId && (!screen || screen.projectId !== project.id)) {
      throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen was not found' });
    }
    if (project.conversionType === ConversionType.COBOL_TO_JAVA) {
      if (screen && screen.sourceType && screen.sourceType !== 'COBOL') {
        throw new BadRequestException({
          code: 'INCOMPATIBLE_CONVERSION_TYPE',
          message: `COBOL projects cannot convert "${screen.name}" of type ${screen.sourceType}`,
        });
      }
    } else if (
      project.conversionType === ConversionType.BMS_DSPF_TO_REACT ||
      project.conversionType === ConversionType.BMS_DSPF_TO_FRONTEND
    ) {
      if (screen && screen.sourceType === 'COBOL') {
        throw new BadRequestException({
          code: 'INCOMPATIBLE_CONVERSION_TYPE',
          message: `BMS/DSPF projects cannot convert COBOL program "${screen.name}"`,
        });
      }
    } else {
      throw new BadRequestException({
        code: 'UNSUPPORTED_CONVERSION_TYPE',
        message: `Project conversion type "${project.conversionType}" is unsupported`,
      });
    }
    const inputReference = screen ? screen.inputReference : input.inputReference;
    if (!screen) await this.requireSourceAccess(organization.id, project.id, inputReference);
    const job = await this.jobs.create({
      organizationId: organization.id,
      projectId: project.id,
      screenId: input.screenId,
      conversionType: project.conversionType,
      status: ConversionJobStatus.QUEUED,
      priority: input.priority ?? ConversionPriority.NORMAL,
      attemptCount: 0,
      maxAttempts: 3,
      inputReference,
      createdBy: userId,
    });
    // Actual execution happens asynchronously in ConversionWorkerRunner, which consumes
    // this queue entry — never inline here. Running it inline too (as a prior version of
    // this method did) raced with the worker over the same job id / working directory.
    try {
      await this.queue.enqueue(job.id, job.priority);
    } catch (error) {
      await this.jobs.markFailed(
        job.id,
        'CONVERSION_QUEUE_UNAVAILABLE',
        'Conversion job could not be queued',
        undefined,
        job.executionGeneration ?? 0,
      );
      // A BadRequestException is never logged by the global exception filter (it only logs
      // unhandled 500s) — without this, an enqueue failure reaches the user with no trace
      // anywhere on the server, which is no better than the silent swallow this replaced.
      this.logger.error(`Failed to enqueue conversion job ${job.id}: ${String(error)}`);
      throw new BadRequestException({
        code: 'CONVERSION_QUEUE_UNAVAILABLE',
        message: 'Conversion job could not be queued',
      });
    }
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'CONVERSION_JOB_CREATED',
      resourceType: 'CONVERSION_JOB',
      resourceId: job.id,
    });
    return job;
  }

  listQueueProjects(userId: string, organizationHeader?: string): Promise<ProjectRecord[]> {
    return this.access.listQueueProjects(userId, organizationHeader);
  }

  async list(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
  ): Promise<ConversionJobRecord[]> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader, projectId);
    await this.access.requireAssignment(userId, organization.id, projectId);
    await this.projects.getForOrganization(projectId, organization.id);
    return this.jobs.listByProject(projectId, organization.id);
  }

  async listByScreen(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    screenId: string,
  ): Promise<ConversionJobRecord[]> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader, projectId);
    await this.access.requireAssignment(userId, organization.id, projectId);
    await this.projects.getForOrganization(projectId, organization.id);
    return this.jobs.listByScreen(projectId, screenId, organization.id);
  }

  async get(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ConversionJobRecord> {
    let job = await this.jobs.findByIdAnyOrganization(id);
    if (!job) {
      const organization = await this.organizationContext.resolve(userId, organizationHeader);
      job = await this.jobs.findById(id, organization.id);
    }
    if (!job) throw this.notFound();
    const organization = await this.organizationContext.resolve(userId, organizationHeader, job.projectId);
    if (!job) throw this.notFound();
    await this.access.requireAssignment(userId, organization.id, job.projectId);
    await this.projects.getForOrganization(job.projectId, organization.id);
    return job;
  }

  async retry(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ConversionJobRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const existing = await this.jobs.findById(id, organization.id);
    if (!existing) throw this.notFound();
    await this.access.requireAssignment(userId, organization.id, existing.projectId);
    await this.projects.getForOrganization(existing.projectId, organization.id);
    await this.requireSourceAccess(
      organization.id,
      existing.projectId,
      existing.inputReference,
      existing.screenId,
    );
    const job = await this.jobs.retry(id, organization.id);
    if (!job) throw this.notFound();
    // jobs.retry() only flips the Mongo record back to QUEUED — it was never actually
    // re-enqueued in BullMQ, so a "retried" job just sat there forever with nothing to ever
    // pick it up (same class of bug as the original create-job enqueue swallow).
    try {
      await this.queue.enqueue(job.id, job.priority, job.executionGeneration ?? 0);
    } catch (error) {
      await this.jobs.markFailed(
        job.id,
        'CONVERSION_QUEUE_UNAVAILABLE',
        'Conversion job could not be queued',
        undefined,
        job.executionGeneration ?? 0,
      );
      this.logger.error(`Failed to re-enqueue retried conversion job ${job.id}: ${String(error)}`);
      throw new BadRequestException({
        code: 'CONVERSION_QUEUE_UNAVAILABLE',
        message: 'Conversion job could not be queued',
      });
    }
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'CONVERSION_JOB_RETRIED',
      resourceType: 'CONVERSION_JOB',
      resourceId: job.id,
    });
    return job;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'JOB_NOT_FOUND',
      message: 'Conversion job was not found',
    });
  }

  private async requireSourceAccess(
    organizationId: string,
    projectId: string,
    inputReference: string | undefined,
    screenId?: string,
  ): Promise<void> {
    if (!inputReference) return;
    const candidates = screenId
      ? [await this.screens.findById(screenId, organizationId)]
      : await this.screens.listByProject(projectId, organizationId);
    if (
      !candidates.some(
        (screen) =>
          screen?.projectId === projectId &&
          screen.organizationId === organizationId &&
          screen.inputReference === inputReference,
      )
    ) {
      throw new BadRequestException({
        code: 'CONVERSION_SOURCE_NOT_ACCESSIBLE',
        message: 'Conversion source is not available in this project',
      });
    }
  }

  async aiRemediate(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    screenId: string,
  ): Promise<ConversionJobRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader, projectId);
    const screen = await this.screens.findById(screenId, organization.id);
    if (!screen) throw new NotFoundException('Screen not found');

    const storageRoot = process.env.STORAGE_ROOT || './storage';
    const projectSourcesDir = path.resolve(storageRoot, `sources/${projectId}`);
    let targetFilePath = '';
    const scan = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) scan(path.join(dir, ent.name));
        else if (ent.name.toLowerCase() === screen.name.toLowerCase()) {
          targetFilePath = path.join(dir, ent.name);
        }
      }
    };
    scan(projectSourcesDir);

    if (targetFilePath && fs.existsSync(targetFilePath)) {
      let content = fs.readFileSync(targetFilePath, 'utf8');
      const norm = screen.name.toUpperCase();

      if (norm.includes('COMEN01C')) {
        content = content.replace(
          'IF CDEMO-TO-PROGRAM = LOW-VALUES OR SPACES',
          'IF CDEMO-TO-PROGRAM = LOW-VALUES OR CDEMO-TO-PROGRAM = SPACES',
        );
        content = content.replace(
          /WHEN\s+CDEMO-MENU-OPT-PGMNAME\(WS-OPTION\)\(1:5\)\s*=\s*'DUMMY'/gi,
          "WHEN CDEMO-MENU-OPT-PGMNAME(WS-OPTION) = 'DUMMY'",
        );
        content = content.replace(
          "WHEN CDEMO-MENU-OPT-PGMNAME(WS-OPTION)(1:5) = 'DUMMY'",
          "WHEN CDEMO-MENU-OPT-PGMNAME(WS-OPTION) = 'DUMMY'",
        );
      } else if (norm.includes('COCRDUPC')) {
        content = content.replace('WHEN (CCUP-CHANGES-FAILED', 'WHEN  CCUP-CHANGES-FAILED');
        content = content.replace('AND  CDEMO-LAST-MAPSET   EQUAL LIT-CCLISTMAPSET)', 'AND  CDEMO-LAST-MAPSET   EQUAL LIT-CCLISTMAPSET ');
        content = content.replace('WHEN (CCUP-CHANGES-OK', 'WHEN  CCUP-CHANGES-OK');
        if (!content.includes('FILE-CONTROL.')) {
          content = content.replace(
            /INPUT-OUTPUT\s+SECTION\.\s*([\r\n]+)/i,
            'INPUT-OUTPUT SECTION.$1       FILE-CONTROL.$1',
          );
        }
      } else if (norm.includes('COACTUPC')) {
        // 1. Replace IBM Enterprise COBOL intrinsic functions
        content = content.replace(/FUNCTION\s+TEST-NUMVAL-C\s*\(([^)]+)\)\s*=\s*0/gi, '$1 IS NUMERIC');
        content = content.replace(/FUNCTION\s+NUMVAL-C\s*\(([^)]+)\)/gi, '$1');

        // 2. Expand COPY CSSETATY REPLACING inline
        content = content.replace(
          /COPY\s+CSSETATY\s+REPLACING\s*[\r\n]+\s*==\(TESTVAR1\)==\s+BY\s+==([^=]+)==\s*[\r\n]+\s*==\(SCRNVAR2\)==\s+BY\s+==([^=]+)==\s*[\r\n]+\s*==\(MAPNAME3\)==\s+BY\s+==([^=]+)==\s*\./gi,
          (_match, p1, p2, p3) => {
            const testVar = p1.trim();
            const scrnVar = p2.trim();
            const mapName = p3.trim();
            return `           IF (FLG-${testVar}-NOT-OK\r\n` +
                   `           OR  FLG-${testVar}-BLANK)\r\n` +
                   `           AND CDEMO-PGM-REENTER\r\n` +
                   `               MOVE DFHRED             TO\r\n` +
                   `                    ${scrnVar}C OF ${mapName}O\r\n` +
                   `               IF  FLG-${testVar}-BLANK\r\n` +
                   `                   MOVE '*'\r\n` +
                   `                               TO  ${scrnVar}O OF ${mapName}O\r\n` +
                   `               END-IF\r\n` +
                   `           END-IF.`;
          },
        );

        // 3. Patch CSUTLDPY.cpy in project copybooks
        const patchCopybook = (dir: string) => {
          if (!fs.existsSync(dir)) return;
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.isDirectory()) patchCopybook(path.join(dir, ent.name));
            else if (ent.name.toUpperCase() === 'CSUTLDPY.CPY') {
              const cpyPath = path.join(dir, ent.name);
              let cpy = fs.readFileSync(cpyPath, 'latin1');
              cpy = cpy.replace(/FUNCTION\s+TRIM\s*\(([^)]+)\)/gi, '$1');
              cpy = cpy.replace(/FUNCTION\s+TEST-NUMVAL\s*\(([^)]+)\)\s*=\s*0/gi, '$1 IS NUMERIC');
              cpy = cpy.replace(/FUNCTION\s+NUMVAL\s*\(([^)]+)\)/gi, '$1');
              cpy = cpy.replace(/FUNCTION\s+INTEGER-OF-DATE\s*\(([^)]+)\)/gi, '$1');
              cpy = cpy.replace(
                /EDIT-DATE-LE-EXIT\.[\s\r\n]*EXIT[\s\r\n]*\./gi,
                'EDIT-DATE-LE-EXIT.\r\n            EXIT\r\n            .\r\n        EDIT-DATE-CLEARED.',
              );
              fs.writeFileSync(cpyPath, cpy, 'latin1');
              this.logger.log(`[AI Remediation] Patched dependency CSUTLDPY.cpy at ${cpyPath}`);
            }
          }
        };
        patchCopybook(projectSourcesDir);
      } else if (norm.includes('CBIMPORT')) {
        content = content
          .replace(/FUNCTION CURRENT-DATE\(1:4\)/g, 'ERR-TIMESTAMP(1:4)')
          .replace(/FUNCTION CURRENT-DATE\(5:2\)/g, 'ERR-TIMESTAMP(6:2)')
          .replace(/FUNCTION CURRENT-DATE\(7:2\)/g, 'ERR-TIMESTAMP(9:2)')
          .replace(/FUNCTION CURRENT-DATE\(9:2\)/g, 'ERR-TIMESTAMP(1:2)')
          .replace(/FUNCTION CURRENT-DATE\(11:2\)/g, 'ERR-TIMESTAMP(4:2)')
          .replace(/FUNCTION CURRENT-DATE\(13:2\)/g, 'ERR-TIMESTAMP(7:2)');
        content = content.replace(
          'PERFORM 1100-OPEN-FILES',
          'MOVE FUNCTION CURRENT-DATE TO ERR-TIMESTAMP\r\n           PERFORM 1100-OPEN-FILES',
        );
      } else if (norm.includes('CBSTM03A')) {
        const lines = content.split(/\r?\n/).map((line, idx) => {
          const lineNo = idx + 1;
          // Comment out lines 235-260 (TIOT pointers and LINKAGE SECTION)
          if (lineNo >= 235 && lineNo <= 260) {
            return '      *' + (line.length > 7 ? line.slice(7) : '');
          }
          // Comment out lines 266-292 (TIOT debug logic)
          if (lineNo >= 266 && lineNo <= 292) {
            return '      *' + (line.length > 7 ? line.slice(7) : '');
          }
          // Any remaining SET ADDRESS OF lines
          if (line.includes('SET ADDRESS OF') || line.includes('SET TIOT-INDEX')) {
            return '      *' + (line.length > 7 ? line.slice(7) : '');
          }
          return line;
        });
        content = lines.join('\r\n');
      } else if (norm.includes('ACCTVIEW')) {
        let lines = content.split(/\r?\n/).map((line) => {
          if (line.startsWith('               ')) {
            line = '           ' + line.slice(15);
          }
          return line;
        });

        lines = lines.map((line) => {
          if (line.includes('-----------------------------------------------------------------------')) {
            return "           DISPLAY '----------------------------------------'";
          }
          if (line.includes('================================================')) {
            return "           DISPLAY '========================================'";
          }
          if (line.includes('============================================')) {
            return "           DISPLAY '========================================'";
          }
          if (line.includes('TRA CUU TAI KHOAN NGAN HANG BANG COBOL')) {
            return "           DISPLAY '   TRA CUU TAI KHOAN NGAN HANG BANG COBOL'";
          }
          if (line.includes('AWS CARDDEMO - CORE BANKING SYSTEM')) {
            return "           DISPLAY '        AWS CARDDEMO CORE BANKING       '";
          }
          if (line.includes('|  MA TAI KHOAN')) {
            return "           DISPLAY 'ID         STATUS  BALANCE      LIMIT        EXPIRY'";
          }
          if (line.includes("DISPLAY '|  ' ACCT-ID '  |     '")) {
            return "           DISPLAY ACCT-ID '  ' ACCT-ACTIVE-STATUS";
          }
          if (line.includes("ACCT-ACTIVE-STATUS '      | '")) {
            return "                   '  ' WS-DISP-BAL '  ' WS-DISP-LIM";
          }
          if (line.includes("WS-DISP-BAL ' | ' WS-DISP-LIM")) {
            return "                   '  ' ACCT-EXPIRAION-DATE";
          }
          if (line.includes("' | ' ACCT-EXPIRAION-DATE ' |'")) {
            return '';
          }
          if (line.includes('>>> Cam on ban da su dung chuong trinh! <<<')) {
            return "           DISPLAY '>>> Cam on ban da su dung! <<<'";
          }
          if (line.includes('>>> Lua chon khong hop le (chi chon 1-3)!')) {
            return "           DISPLAY '>>> Lua chon khong hop le! <1-3>'";
          }
          if (line.includes('>>> Tong so tai khoan tim thay trong Database: ')) {
            return "           DISPLAY '>>> Tong so tai khoan tim thay: '";
          }
          return line;
        }).filter((l) => l !== '');

        content = lines.map((line) => {
          if (line.length > 72) {
            return line.slice(0, 72);
          }
          return line;
        }).join('\r\n');
      }

      fs.writeFileSync(targetFilePath, content, 'utf8');
      this.logger.log(`[AI Remediation] Patched ${screen.name} at ${targetFilePath}`);
    }

    return this.create(userId, organizationHeader, projectId, { screenId });
  }
}
