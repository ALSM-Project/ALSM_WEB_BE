import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DiagnosticReaderFactory,
  DiagnosticReadQuery,
  DiagnosticRow,
} from '../../../shared/application/diagnostic-read.port';
import { SUPPORT_PROJECT_READER } from '../../projects/application/support-project-reader.port';
import { SUPPORT_SCREEN_READER } from '../../screens/application/support-screen-reader.port';
import { SUPPORT_CONVERSION_READER } from '../../conversions/application/support-conversion-reader.port';
import { SUPPORT_FINDING_READER } from '../../validation/application/support-finding-reader.port';
import {
  SUPPORT_ORGANIZATION_DIRECTORY,
  SupportOrganizationDirectory,
} from '../../organizations/domain/support-organization-directory.port';
import { SupportContextError } from '../domain/support-context.entity';
import { mapSupportContextError, supportDenied, supportIdentifier } from './support-context.errors';
import {
  SUPPORT_CLOCK,
  SUPPORT_CONTEXT_UNIT_OF_WORK,
  SupportClock,
  SupportContextUnitOfWork,
  SupportPrincipal,
} from './support-context.ports';
import { SupportStaffAccessService } from './support-staff-access.service';
import { randomUUID } from 'node:crypto';
import { SUPPORT_INSPECTION, SupportInspection } from './support-inspection.port';

export const SUPPORT_WORKSPACE_OPERATIONS = Object.freeze({
  projects: ['WORKSPACE_PROJECT_LIST', 'WORKSPACE_PROJECT_DETAIL'],
  screens: ['WORKSPACE_SCREEN_LIST', 'WORKSPACE_SCREEN_DETAIL'],
  programs: ['WORKSPACE_PROGRAM_LIST', 'WORKSPACE_PROGRAM_DETAIL'],
  findings: ['WORKSPACE_FINDING_LIST', 'WORKSPACE_FINDING_DETAIL'],
  'conversion-logs': ['WORKSPACE_CONVERSION_LOG_LIST', 'WORKSPACE_CONVERSION_LOG_DETAIL'],
  'error-logs': ['WORKSPACE_ERROR_LOG_LIST', 'WORKSPACE_ERROR_LOG_DETAIL'],
} as const);
export type SupportWorkspaceKind = keyof typeof SUPPORT_WORKSPACE_OPERATIONS;
export interface SupportWorkspaceInput {
  organizationId: string;
  contextId: string;
  projectId?: string;
  id?: string;
  afterId?: string;
  limit?: number;
  kind: SupportWorkspaceKind;
}

@Injectable()
export class ReadSupportWorkspaceService {
  constructor(
    private readonly access: SupportStaffAccessService,
    @Inject(SUPPORT_ORGANIZATION_DIRECTORY)
    private readonly organizations: SupportOrganizationDirectory,
    @Inject(SUPPORT_CONTEXT_UNIT_OF_WORK) private readonly transactions: SupportContextUnitOfWork,
    @Inject(SUPPORT_CLOCK) private readonly clock: SupportClock,
    @Inject(SUPPORT_PROJECT_READER) private readonly projects: DiagnosticReaderFactory,
    @Inject(SUPPORT_SCREEN_READER) private readonly screens: DiagnosticReaderFactory,
    @Inject(SUPPORT_CONVERSION_READER) private readonly conversions: DiagnosticReaderFactory,
    @Inject(SUPPORT_FINDING_READER) private readonly findings: DiagnosticReaderFactory,
    @Inject(SUPPORT_INSPECTION) private readonly inspection: SupportInspection,
  ) {}

  async execute(principal: SupportPrincipal, input: SupportWorkspaceInput, operation: string) {
    const operationId = randomUUID();
    const actor = { ...principal },
      scope = { ...input };
    supportIdentifier(scope.organizationId);
    supportIdentifier(scope.contextId, true);
    for (const id of [scope.projectId, scope.id, scope.afterId])
      if (id !== undefined) supportIdentifier(id);
    const limit = scope.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 25 || (scope.id && scope.afterId))
      throw new BadRequestException({
        code: 'INVALID_SUPPORT_PAGE',
        message: 'Invalid bounded page',
      });
    if (
      !Object.hasOwn(SUPPORT_WORKSPACE_OPERATIONS, scope.kind) ||
      operation !== SUPPORT_WORKSPACE_OPERATIONS[scope.kind][scope.id ? 1 : 0]
    )
      throw supportDenied();
    if (
      (scope.kind !== 'projects' && !scope.projectId) ||
      (scope.kind === 'projects' && scope.projectId)
    )
      throw supportDenied();
    const admission = await this.access.require(actor, this.clock.now());
    const query: DiagnosticReadQuery = { ...scope, limit };
    try {
      const committed = await this.transactions.run(
        scope.contextId,
        async ({ contexts, audit, readTransaction }) => {
          if (!readTransaction)
            throw new ServiceUnavailableException({ code: 'SUPPORT_READ_TRANSACTION_REQUIRED' });
          await this.access.recheck(actor, admission, this.clock.now());
          const context = await contexts.scoped({
            id: scope.contextId,
            organizationId: scope.organizationId,
            actorUserId: admission.actorUserId,
            originalSessionId: admission.originalSessionId,
          });
          if (!context)
            throw new NotFoundException({
              code: 'SUPPORT_CONTEXT_NOT_FOUND',
              message: 'Support context unavailable',
            });
          const props = context.toProps();
          const canCommitActivity = context.captureActivityWindow();
          if (
            props.sessionVersion !== admission.sessionVersion ||
            props.authorityBinding !== admission.authorityBinding
          )
            throw supportDenied();
          if (!context.isActive(this.clock.now()))
            throw new SupportContextError('SUPPORT_CONTEXT_INACTIVE');
          if (!(await this.organizations.eligible(scope.organizationId, this.clock.now())))
            throw supportDenied();
          if (scope.projectId) {
            const parent = await this.projects.bind(readTransaction).read({
              organizationId: scope.organizationId,
              id: scope.projectId,
              kind: 'projects',
              limit: 1,
            });
            if (parent.length !== 1) throw this.missing();
          }
          const factory =
            scope.kind === 'projects'
              ? this.projects
              : ['screens', 'programs'].includes(scope.kind)
                ? this.screens
                : scope.kind === 'findings'
                  ? this.findings
                  : this.conversions;
          const rows = await factory.bind(readTransaction).read(query);
          if (scope.id && rows.length !== 1) throw this.missing();
          // Validate every finding's job as well as the run/finding links checked by Validation.
          for (const jobId of new Set(
            rows
              .map((row: DiagnosticRow) => row.conversionJobId)
              .filter((id): id is string => id !== undefined),
          )) {
            const job = await this.conversions
              .bind(readTransaction)
              .read({ ...query, kind: 'conversion-logs', id: jobId, afterId: undefined });
            if (job.length !== 1) throw this.missing();
          }
          await this.access.recheck(actor, admission, this.clock.now());
          if (!(await this.organizations.eligible(scope.organizationId, this.clock.now())))
            throw supportDenied();
          context.activity(this.clock.now());
          const items = rows.slice(0, scope.id ? 1 : limit).map((row) => row.view);
          const value = scope.id
            ? { item: items[0] }
            : { items, nextAfterId: rows.length > limit ? items.at(-1)!.id : null };
          await contexts.save(context, props.revision);
          await audit.append({
            actorUserId: props.actorUserId,
            organizationId: scope.organizationId,
            action: 'SUPPORT_WORKSPACE_READ',
            resourceType: `SUPPORT_${scope.kind.toUpperCase().replaceAll('-', '_')}`,
            resourceId: scope.id ?? scope.projectId ?? scope.organizationId,
            metadata: {
              contextId: scope.contextId,
              operationId,
              originalSessionId: props.originalSessionId,
              operation,
              mode: 'READ_ONLY',
              projectId: scope.projectId ?? '',
              returnedResourceIds: items.map((item) => item.id).join(','),
              afterId: scope.afterId ?? '',
              limit: String(limit),
              authorizedAt: this.clock.now().toISOString(),
            },
          });
          // A fresh independent snapshot observes ownership changes made after the
          // original projection snapshot. It cannot extend or mutate the context.
          await this.assertCurrentOwnership(query, rows);
          if (!(await this.organizations.eligible(scope.organizationId, this.clock.now())))
            throw supportDenied();
          await this.access.recheck(actor, admission, this.clock.now());
          if (!canCommitActivity(this.clock.now()))
            throw new ConflictException({
              code: 'SUPPORT_CONTEXT_INACTIVE',
              message: 'Support context expired before commit',
            });
          return { context, value, rows: rows.slice(0, scope.id ? 1 : limit) };
        },
      );
      // Approved bounded in-flight gate. Persisted context (including another
      // instance's Exit), current ownership and live authority precede delivery.
      // Bytes may complete after this gate; committed audit is never rolled back.
      try {
        await this.assertCurrentOwnership(query, committed.rows);
        if (!(await this.organizations.eligible(scope.organizationId, this.clock.now())))
          throw supportDenied();
        await this.access.recheck(actor, admission, this.clock.now());
        const current = await this.inspection.scoped({
          id: scope.contextId,
          organizationId: scope.organizationId,
          actorUserId: admission.actorUserId,
          originalSessionId: admission.originalSessionId,
        });
        if (
          !current?.isActive(this.clock.now()) ||
          current.toProps().authorityBinding !== admission.authorityBinding ||
          current.toProps().sessionVersion !== admission.sessionVersion
        )
          throw supportDenied();
      } catch (error) {
        const body = {
          code: 'SUPPORT_WORKSPACE_DELIVERY_WITHHELD',
          message: 'Resource response withheld after final admission check',
          details: [
            { contextId: scope.contextId, operationId, activityCommitted: true, retrySafe: false },
          ],
        };
        if (error instanceof HttpException && [401, 403].includes(error.getStatus()))
          throw new ForbiddenException(body);
        throw new ServiceUnavailableException(body);
      }
      return { ...committed.value, operationId };
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse();
        if (
          typeof body === 'object' &&
          body !== null &&
          'code' in body &&
          body.code === 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED'
        ) {
          throw new ServiceUnavailableException({
            ...body,
            details: [
              {
                contextId: scope.contextId,
                operationId,
                mutationCommitted: 'unknown',
                retrySafe: false,
              },
            ],
          });
        }
      }
      return mapSupportContextError(error);
    }
  }
  private async assertCurrentOwnership(query: DiagnosticReadQuery, rows: DiagnosticRow[]) {
    await this.inspection.snapshot(async (transaction) => {
      if (query.projectId) {
        const parent = await this.projects.bind(transaction).read({
          organizationId: query.organizationId,
          kind: 'projects',
          id: query.projectId,
          limit: 1,
        });
        if (parent.length !== 1) throw this.missing();
      }
      const factory =
        query.kind === 'projects'
          ? this.projects
          : ['screens', 'programs'].includes(query.kind)
            ? this.screens
            : query.kind === 'findings'
              ? this.findings
              : this.conversions;
      for (const row of rows) {
        const current = await factory
          .bind(transaction)
          .read({ ...query, id: row.view.id, afterId: undefined, limit: 1 });
        if (current.length !== 1 || current[0].view.id !== row.view.id) throw this.missing();
        if (current[0].conversionJobId) {
          const job = await this.conversions.bind(transaction).read({
            ...query,
            kind: 'conversion-logs',
            id: current[0].conversionJobId,
            afterId: undefined,
            limit: 1,
          });
          if (job.length !== 1) throw this.missing();
        }
      }
    });
  }
  private missing() {
    return new NotFoundException({
      code: 'SUPPORT_RESOURCE_NOT_FOUND',
      message: 'Resource unavailable in this scope',
    });
  }
}
