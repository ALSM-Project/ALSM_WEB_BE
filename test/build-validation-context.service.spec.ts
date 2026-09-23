import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BuildValidationContextService } from '../src/modules/validation/application/build-validation-context.service';
import {
  ConversionJobRecord,
  ConversionJobRepository,
  ConversionJobStatus,
  ConversionPriority,
} from '../src/modules/conversions/domain/conversion-job.types';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import { StoragePort } from '../src/shared/storage/storage.port';

describe('BuildValidationContextService', () => {
  const conversionJobs = { findById: jest.fn() };
  const storage = { readFiles: jest.fn() };
  const service = new BuildValidationContextService(
    conversionJobs as unknown as ConversionJobRepository,
    storage as unknown as StoragePort,
  );
  const completedConversion: ConversionJobRecord = {
    id: 'job-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    screenId: 'screen-1',
    conversionType: ConversionType.COBOL_TO_JAVA,
    status: ConversionJobStatus.COMPLETED,
    priority: ConversionPriority.NORMAL,
    attemptCount: 1,
    maxAttempts: 3,
    inputReference: 'sources/project-1/job-1',
    resultReference: 'results/project-1/job-1',
    toolVersion: 'converter-2.0.0',
    createdBy: 'user-1',
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:01:00.000Z'),
    completedAt: new Date('2026-09-20T00:01:00.000Z'),
  };
  const input = {
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'job-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    conversionJobs.findById.mockResolvedValue(completedConversion);
  });

  it('builds source and target context from completed conversion storage references', async () => {
    storage.readFiles
      .mockResolvedValueOnce([
        { relativePath: 'legacy/ACCOUNT.cbl', content: Buffer.from('DISPLAY "Xin chào".') },
      ])
      .mockResolvedValueOnce([
        { relativePath: 'src/Account.java', content: Buffer.from('class Account {}') },
      ]);

    await expect(service.execute(input)).resolves.toEqual({
      conversionJobId: 'job-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      screenId: 'screen-1',
      conversionType: ConversionType.COBOL_TO_JAVA,
      sourceFiles: [{ path: 'legacy/ACCOUNT.cbl', content: 'DISPLAY "Xin chào".' }],
      targetFiles: [{ path: 'src/Account.java', content: 'class Account {}' }],
      toolVersion: 'converter-2.0.0',
    });
    expect(conversionJobs.findById).toHaveBeenCalledWith('job-1', 'org-1');
    expect(storage.readFiles).toHaveBeenNthCalledWith(1, completedConversion.inputReference);
    expect(storage.readFiles).toHaveBeenNthCalledWith(2, completedConversion.resultReference);
  });

  it('rejects a conversion missing from the requested organization', async () => {
    conversionJobs.findById.mockResolvedValue(null);

    await expect(service.execute(input)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_CONVERSION_NOT_FOUND' }),
    });
    expect(storage.readFiles).not.toHaveBeenCalled();
  });

  it('rejects a conversion that belongs to another project without reading artifacts', async () => {
    conversionJobs.findById.mockResolvedValue({
      ...completedConversion,
      projectId: 'project-2',
    });

    await expect(service.execute(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.readFiles).not.toHaveBeenCalled();
  });

  it.each([
    ConversionJobStatus.QUEUED,
    ConversionJobStatus.PROCESSING,
    ConversionJobStatus.FAILED,
    ConversionJobStatus.DEAD,
    ConversionJobStatus.CANCELLED,
  ])('rejects a conversion in %s status', async (status) => {
    conversionJobs.findById.mockResolvedValue({ ...completedConversion, status });

    await expect(service.execute(input)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_CONVERSION_NOT_READY' }),
    });
    expect(storage.readFiles).not.toHaveBeenCalled();
  });

  it('rejects a completed conversion without a source reference', async () => {
    conversionJobs.findById.mockResolvedValue({
      ...completedConversion,
      inputReference: undefined,
    });

    await expect(service.execute(input)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_SOURCE_NOT_AVAILABLE' }),
    });
    expect(storage.readFiles).not.toHaveBeenCalled();
  });

  it('rejects a completed conversion without a result reference', async () => {
    conversionJobs.findById.mockResolvedValue({
      ...completedConversion,
      resultReference: undefined,
    });

    const execution = service.execute(input);
    await expect(execution).rejects.toBeInstanceOf(BadRequestException);
    await expect(execution).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_RESULT_NOT_AVAILABLE' }),
    });
    expect(storage.readFiles).not.toHaveBeenCalled();
  });
});
