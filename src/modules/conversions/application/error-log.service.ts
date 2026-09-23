import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { ProjectService } from '../../projects/application/project.service';
import {
  ERROR_LOG_REPOSITORY,
  ErrorLogListQuery,
  ErrorLogRecord,
  ErrorLogRepository,
  ErrorLogSummary,
  PaginatedErrorLogs,
} from '../domain/error-log.types';

@Injectable()
export class ErrorLogService {
  constructor(
    @Inject(ERROR_LOG_REPOSITORY) private readonly errorLogs: ErrorLogRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly projects: ProjectService,
  ) {}

  /**
   * UC-17: Lấy danh sách error logs theo project với filter + pagination
   */
  async list(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    query: ErrorLogListQuery,
  ): Promise<PaginatedErrorLogs> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    await this.projects.getForOrganization(projectId, organization.id);
    return this.errorLogs.list(projectId, organization.id, query);
  }

  /**
   * UC-17: Lấy chi tiết 1 error log theo ID
   */
  async getById(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    logId: string,
  ): Promise<ErrorLogRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    await this.projects.getForOrganization(projectId, organization.id);
    const log = await this.errorLogs.findById(logId, projectId, organization.id);
    if (!log) throw this.notFound();
    return log;
  }

  /**
   * UC-17: Lấy tổng hợp thống kê error logs (Fatal/Warning/Resolved count)
   */
  async getSummary(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
  ): Promise<ErrorLogSummary> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    await this.projects.getForOrganization(projectId, organization.id);
    return this.errorLogs.getSummary(projectId, organization.id);
  }

  /**
   * UC-17: Đánh dấu error log đã được resolved (áp dụng AI fix)
   */
  async resolve(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    logId: string,
  ): Promise<ErrorLogRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    await this.projects.getForOrganization(projectId, organization.id);

    const log = await this.errorLogs.resolve(logId, projectId, organization.id, userId);
    if (!log) {
      const exists = await this.errorLogs.findById(logId, projectId, organization.id);
      if (!exists) throw this.notFound();
      // Already resolved — return as-is
      return exists;
    }
    return log;
  }

  /**
   * UC-17: Bỏ qua (ignore) một error log
   */
  async ignore(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    logId: string,
  ): Promise<ErrorLogRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    await this.projects.getForOrganization(projectId, organization.id);

    const log = await this.errorLogs.ignore(logId, projectId, organization.id);
    if (!log) {
      const exists = await this.errorLogs.findById(logId, projectId, organization.id);
      if (!exists) throw this.notFound();
      return exists;
    }
    return log;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'ERROR_LOG_NOT_FOUND', message: 'Error log was not found' });
  }
}
