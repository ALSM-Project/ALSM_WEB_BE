import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GetConversionResultService } from '../src/modules/conversions/application/get-conversion-result.service';
import {
  ConversionJobRepository,
  ConversionJobStatus,
} from '../src/modules/conversions/domain/conversion-job.types';
import { StoragePort } from '../src/shared/storage/storage.port';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';

describe('GetConversionResultService', () => {
  const jobs = { findById: jest.fn() };
  const storage = { readFiles: jest.fn(), writeFiles: jest.fn(), resolvePath: jest.fn() };
  const organizationContext = { resolve: jest.fn() };
  const service = new GetConversionResultService(
    jobs as unknown as ConversionJobRepository,
    storage as unknown as StoragePort,
    organizationContext as unknown as OrganizationContextService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    organizationContext.resolve.mockResolvedValue({ id: 'org-1' });
  });

  it('throws NotFoundException when the job does not exist in the resolved organization', async () => {
    jobs.findById.mockResolvedValue(null);
    await expect(service.execute('u1', 'org-1', 'job-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when the job has not completed yet', async () => {
    jobs.findById.mockResolvedValue({ id: 'job-1', status: ConversionJobStatus.PROCESSING });
    await expect(service.execute('u1', 'org-1', 'job-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns decoded file contents for a completed job', async () => {
    jobs.findById.mockResolvedValue({
      id: 'job-1',
      status: ConversionJobStatus.COMPLETED,
      resultReference: 'results/p1/job-1',
      toolVersion: 'convert2fe',
    });
    storage.readFiles.mockResolvedValue([
      { relativePath: 'Login.tsx', content: Buffer.from('export const Login = () => null;') },
    ]);

    const result = await service.execute('u1', 'org-1', 'job-1');

    expect(result).toEqual({
      conversionJobId: 'job-1',
      toolVersion: 'convert2fe',
      files: [{ relativePath: 'Login.tsx', content: 'export const Login = () => null;' }],
    });
  });
});
