import { NotFoundException } from '@nestjs/common';
import { UploadPartnerProjectSourceService } from '../src/modules/partners/application/upload-partner-project-source.service';
import { UploadConversionSourceService } from '../src/modules/conversions/application/upload-conversion-source.service';
import { PartnerRepository, PartnerStatus } from '../src/modules/partners/domain/partner.types';

const existingPartner = {
  id: 'partner-1',
  name: 'Acme Vendor',
  contactEmail: 'partner@vendor.com',
  status: PartnerStatus.ACTIVE,
  createdBy: 'staff-0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UploadPartnerProjectSourceService (UC-46)', () => {
  let partners: jest.Mocked<PartnerRepository>;
  let uploadConversionSource: jest.Mocked<UploadConversionSourceService>;
  let service: UploadPartnerProjectSourceService;

  beforeEach(() => {
    partners = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      list: jest.fn(),
      setOrganizationId: jest.fn(),
    } as unknown as jest.Mocked<PartnerRepository>;
    uploadConversionSource = {
      execute: jest.fn(),
      executeForOrganization: jest.fn(),
    } as unknown as jest.Mocked<UploadConversionSourceService>;
    service = new UploadPartnerProjectSourceService(partners, uploadConversionSource);
  });

  const realFile = { originalname: 'CBACT01C.cbl', buffer: Buffer.from('COBOL SOURCE'), size: 12 };

  it('rejects a non-existent partner with 404', async () => {
    partners.findById.mockResolvedValue(null);
    await expect(service.execute('staff-1', 'missing-partner', 'project-1', [realFile])).rejects.toThrow(
      NotFoundException,
    );
    expect(uploadConversionSource.executeForOrganization).not.toHaveBeenCalled();
  });

  it('rejects a partner with no projects/workspace yet, with a real specific reason', async () => {
    partners.findById.mockResolvedValue({ ...existingPartner, organizationId: undefined });
    await expect(service.execute('staff-1', 'partner-1', 'project-1', [realFile])).rejects.toThrow(
      NotFoundException,
    );
    expect(uploadConversionSource.executeForOrganization).not.toHaveBeenCalled();
  });

  it("uploads through the partner's real organization once it has one", async () => {
    partners.findById.mockResolvedValue({ ...existingPartner, organizationId: 'org-existing' });
    uploadConversionSource.executeForOrganization.mockResolvedValue({
      inputReference: 'sources/project-1/abc',
      files: [{ name: 'CBACT01C.cbl', sizeBytes: 12 }],
      screens: [],
    });

    const result = await service.execute('staff-1', 'partner-1', 'project-1', [realFile]);

    expect(uploadConversionSource.executeForOrganization).toHaveBeenCalledWith(
      'org-existing',
      'staff-1',
      'project-1',
      [realFile],
    );
    expect(result.inputReference).toBe('sources/project-1/abc');
  });

  it("propagates a real 404 when projectId doesn't belong to this partner's organization", async () => {
    partners.findById.mockResolvedValue({ ...existingPartner, organizationId: 'org-existing' });
    uploadConversionSource.executeForOrganization.mockRejectedValue(
      new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: "Project not found" }),
    );

    await expect(
      service.execute('staff-1', 'partner-1', 'someone-elses-project', [realFile]),
    ).rejects.toThrow(NotFoundException);
  });
});
