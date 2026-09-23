import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TriggerAiValidationService } from '../src/modules/validation/application/trigger-ai-validation.service';
import { AiValidationRuntimeGuard } from '../src/modules/validation/application/ai-validation-runtime.guard';
import {
  ConversionJobRepository,
  ConversionJobStatus,
} from '../src/modules/conversions/domain/conversion-job.types';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationRole } from '../src/modules/organizations/domain/organization.types';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import { ValidationQueuePort } from '../src/modules/validation/domain/validation-queue.port';
import { ValidationRunRepository } from '../src/modules/validation/domain/validation-run.repository';
import { ValidationRunStatus } from '../src/modules/validation/domain/validation-run.types';

describe('TriggerAiValidationService', () => {
  const validationRuns = {
    createOrGetActiveAiRun: jest.fn(),
    markFailed: jest.fn(),
  };
  const queue = { enqueue: jest.fn() };
  const conversionJobs = { findById: jest.fn() };
  const organizationContext = { resolve: jest.fn() };
  const authorization = { require: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  const runtimeGuard = { assertAvailable: jest.fn() };
  const service = new TriggerAiValidationService(
    validationRuns as unknown as ValidationRunRepository,
    queue as unknown as ValidationQueuePort,
    conversionJobs as unknown as ConversionJobRepository,
    organizationContext as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    projects as unknown as ProjectService,
    runtimeGuard as unknown as AiValidationRuntimeGuard,
  );
  const run = {
    id: 'run-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'conversion-1',
    status: ValidationRunStatus.QUEUED,
    ruleValidationEnabled: false,
    aiValidationEnabled: true,
    findingCount: 0,
    provider: 'openai',
    model: 'test-model',
    promptVersion: 'semantic-cobol-java-v1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    organizationContext.resolve.mockResolvedValue({
      id: 'org-1',
      members: [{ userId: 'user-1', role: OrganizationRole.MEMBER }],
    });
    projects.getForOrganization.mockResolvedValue({ id: 'project-1', organizationId: 'org-1' });
    conversionJobs.findById.mockResolvedValue({
      id: 'conversion-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversionType: ConversionType.COBOL_TO_JAVA,
      status: ConversionJobStatus.COMPLETED,
    });
    runtimeGuard.assertAvailable.mockReturnValue({
      provider: 'openai',
      model: 'test-model',
      promptVersion: 'semantic-cobol-java-v1',
    });
    validationRuns.createOrGetActiveAiRun.mockResolvedValue({ run, created: true });
    validationRuns.markFailed.mockResolvedValue(undefined);
    queue.enqueue.mockResolvedValue(undefined);
  });

  it('creates a queued run and enqueues identifiers without invoking AI', async () => {
    await expect(service.execute('user-1', 'org-1', 'project-1', 'conversion-1')).resolves.toEqual({
      run,
      created: true,
    });

    expect(authorization.require).toHaveBeenCalledWith(expect.anything(), 'user-1', [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    expect(validationRuns.createOrGetActiveAiRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ValidationRunStatus.QUEUED,
        provider: 'openai',
        conversionJobId: 'conversion-1',
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith({
      validationRunId: 'run-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversionJobId: 'conversion-1',
    });
  });

  it('returns the same active run without enqueuing a duplicate application request', async () => {
    validationRuns.createOrGetActiveAiRun.mockResolvedValue({ run, created: false });

    await expect(service.execute('user-1', 'org-1', 'project-1', 'conversion-1')).resolves.toEqual({
      run,
      created: false,
    });

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('rejects when AI is disabled or the selected adapter is not real', async () => {
    runtimeGuard.assertAvailable.mockImplementation(() => {
      throw new ServiceUnavailableException({ code: 'VALIDATION_AI_DISABLED' });
    });

    await expect(
      service.execute('user-1', 'org-1', 'project-1', 'conversion-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(validationRuns.createOrGetActiveAiRun).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a conversion that is not completed', async () => {
    conversionJobs.findById.mockResolvedValue({
      id: 'conversion-1',
      projectId: 'project-1',
      conversionType: ConversionType.COBOL_TO_JAVA,
      status: ConversionJobStatus.PROCESSING,
    });

    await expect(
      service.execute('user-1', 'org-1', 'project-1', 'conversion-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(validationRuns.createOrGetActiveAiRun).not.toHaveBeenCalled();
  });

  it('rejects a non-COBOL-to-Java conversion', async () => {
    conversionJobs.findById.mockResolvedValue({
      id: 'conversion-1',
      projectId: 'project-1',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      status: ConversionJobStatus.COMPLETED,
    });

    await expect(
      service.execute('user-1', 'org-1', 'project-1', 'conversion-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('does not expose or claim a conversion from another project', async () => {
    conversionJobs.findById.mockResolvedValue({
      id: 'conversion-1',
      projectId: 'project-2',
      conversionType: ConversionType.COBOL_TO_JAVA,
      status: ConversionJobStatus.COMPLETED,
    });

    await expect(
      service.execute('user-1', 'org-1', 'project-1', 'conversion-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_CONVERSION_NOT_FOUND' }),
    });
    expect(validationRuns.createOrGetActiveAiRun).not.toHaveBeenCalled();
  });

  it('stops before resource access when organization membership fails', async () => {
    organizationContext.resolve.mockRejectedValue(new ForbiddenException());

    await expect(
      service.execute('user-2', 'org-1', 'project-1', 'conversion-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(projects.getForOrganization).not.toHaveBeenCalled();
    expect(conversionJobs.findById).not.toHaveBeenCalled();
  });

  it('marks a newly claimed run failed with a sanitized error when enqueue fails', async () => {
    queue.enqueue.mockRejectedValue(new Error('redis://user:secret@host unavailable'));

    await expect(
      service.execute('user-1', 'org-1', 'project-1', 'conversion-1'),
    ).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_QUEUE_ENQUEUE_FAILED',
        message: 'AI validation could not be queued',
      },
    });
    expect(validationRuns.markFailed).toHaveBeenCalledWith('run-1', 'project-1', 'org-1', {
      failureCode: 'VALIDATION_QUEUE_ENQUEUE_FAILED',
      failureMessage: 'AI validation could not be queued',
    });
  });
});
