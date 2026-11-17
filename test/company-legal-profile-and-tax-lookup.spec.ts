import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderCompanyProfileService } from '../src/modules/admin/application/provider-company-profile.service';
import { TaxIdLookupAdapter } from '../src/modules/organizations/infrastructure/tax-id-lookup.adapter';
import { OrganizationLegalProfileService } from '../src/modules/organizations/application/organization-legal-profile.service';

describe('Company Legal Profile & Tax ID Lookup System', () => {
  describe('TaxIdLookupAdapter', () => {
    let configService: jest.Mocked<ConfigService>;
    let adapter: TaxIdLookupAdapter;

    beforeEach(() => {
      configService = {
        get: jest.fn(),
      } as any;
      adapter = new TaxIdLookupAdapter(configService);
    });

    it('rejects invalid or malformed Tax ID strings', async () => {
      await expect(adapter.lookup('')).rejects.toThrow(BadRequestException);
      await expect(adapter.lookup('12345')).rejects.toThrow(BadRequestException);
      await expect(adapter.lookup('TAX1234567890')).rejects.toThrow(BadRequestException);
      await expect(adapter.lookup('0109876543-ABC')).rejects.toThrow(BadRequestException);
    });

    it('reports unconfigured status when TAX_LOOKUP_API_URL is missing', () => {
      configService.get.mockReturnValue(undefined);
      const status = adapter.getStatus();

      expect(status.isConfigured).toBe(false);
      expect(status.message).toContain('not configured');
      expect(status.supportedFormats).toBeDefined();
    });

    it('throws ServiceUnavailableException when lookup is invoked without configured provider', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(adapter.lookup('0109876543')).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('ProviderCompanyProfileService', () => {
    let mockModel: any;
    let mockAuditRepo: any;
    let service: ProviderCompanyProfileService;

    beforeEach(() => {
      mockModel = {
        findOne: jest.fn(),
        find: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      };
      mockAuditRepo = {
        append: jest.fn().mockResolvedValue(undefined),
      };
      service = new ProviderCompanyProfileService(mockModel, mockAuditRepo);
    });

    it('seeds and returns default ALSM profile if no active profile exists in database', async () => {
      mockModel.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(null),
      });
      const seededProfile = {
        _id: 'seeded_id_1',
        version: 1,
        isActive: true,
        legalName: 'CÔNG TY CỔ PHẦN CÔNG NGHỆ HIỆN ĐẠI HÓA PHẦN MỀM ALSM',
        taxId: '0110892345',
        representativeName: 'Nguyễn Hữu Dũng',
      };
      mockModel.create.mockResolvedValue(seededProfile);

      const profile = await service.getActiveProfile();
      expect(profile).toBeDefined();
      expect(mockModel.create).toHaveBeenCalled();
    });

    it('rejects update if representative name is an account handle or login username', async () => {
      const invalidDto: any = {
        legalName: 'Valid Company Name Corp',
        taxId: '0109876543',
        registeredAddress: '123 Pham Hung Street, Nam Tu Liem, Hanoi',
        representativeName: 'hoangndhde180637', // username format
        representativeTitle: 'Director',
        contactEmail: 'contracts@alsm.io',
        bankName: 'Vietcombank',
        bankAccountNumber: '1029384756',
        bankAccountHolder: 'ALSM CORP',
        signatoryConfig: {
          signerName: 'hoangndhde180637',
          signerTitle: 'Director',
          signerEmail: 'contracts@alsm.io',
        },
      };

      await expect(service.updateProfile(invalidDto)).rejects.toThrow(BadRequestException);
    });

    it('creates a new version, deactivates previous, and records an audit log on valid update', async () => {
      const currentActive = {
        _id: 'active_id_1',
        version: 1,
        isActive: true,
      };
      mockModel.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(currentActive),
      });

      const validDto: any = {
        legalName: 'CÔNG TY CỔ PHẦN CÔNG NGHỆ ALSM ENTERPRISE',
        taxId: '0110892345',
        registeredAddress: 'Tầng 12 Keangnam Landmark 72, Phạm Hùng, Hà Nội',
        representativeName: 'Nguyễn Hữu Dũng',
        representativeTitle: 'Tổng Giám Đốc',
        contactEmail: 'contracts@alsm.io',
        bankName: 'Vietcombank',
        bankAccountNumber: '1029384756',
        bankAccountHolder: 'CONG TY CP CONG NGHE ALSM ENTERPRISE',
        signatoryConfig: {
          signerName: 'Nguyễn Hữu Dũng',
          signerTitle: 'Tổng Giám Đốc',
          signerEmail: 'contracts@alsm.io',
        },
        changeReason: 'Relocation to Landmark 72',
      };

      const newVersionDoc = {
        _id: 'new_id_2',
        ...validDto,
        version: 2,
        isActive: true,
      };
      mockModel.create.mockResolvedValue(newVersionDoc);

      const result = await service.updateProfile(validDto, 'admin_user_1', 'admin@alsm.io');

      expect(mockModel.updateMany).toHaveBeenCalledWith({ isActive: true }, { $set: { isActive: false } });
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 2,
          isActive: true,
          legalName: 'CÔNG TY CỔ PHẦN CÔNG NGHỆ ALSM ENTERPRISE',
        }),
      );
      expect(mockAuditRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COMPANY_LEGAL_PROFILE_UPDATED',
          resourceType: 'ProviderCompanyProfile',
          metadata: expect.objectContaining({
            version: '2',
            legalName: 'CÔNG TY CỔ PHẦN CÔNG NGHỆ ALSM ENTERPRISE',
          }),
        }),
      );
      expect(result.version).toBe(2);
    });
  });

  describe('OrganizationLegalProfileService', () => {
    let mockOrgModel: any;
    let mockTaxProvider: any;
    let mockAuditRepo: any;
    let service: OrganizationLegalProfileService;

    beforeEach(() => {
      mockOrgModel = {
        findById: jest.fn(),
      };
      mockTaxProvider = {
        getStatus: jest.fn(),
        lookup: jest.fn(),
      };
      mockAuditRepo = {
        append: jest.fn().mockResolvedValue(undefined),
      };
      service = new OrganizationLegalProfileService(mockOrgModel, mockTaxProvider, mockAuditRepo);
    });

    it('rejects representative name containing numbers or single token handle', async () => {
      const invalidDto: any = {
        taxId: '0109876543',
        legalCompanyName: 'Customer Tech Vietnam Co.',
        registeredAddress: 'Tòa nhà FPT, Cầu Giấy, Hà Nội',
        legalRepresentative: 'user_admin99',
        representativeTitle: 'CEO',
        contactEmail: 'ceo@customer.com',
      };

      await expect(
        service.updateLegalProfile('507f1f77bcf86cd799439011', invalidDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully updates legal profile with TAX_VERIFIED status and logs audit event', async () => {
      const orgDoc: any = {
        _id: '507f1f77bcf86cd799439011',
        name: 'Customer Tech Vietnam',
        contactEmail: 'info@customer.com',
        save: jest.fn().mockResolvedValue(true),
      };
      mockOrgModel.findById.mockResolvedValue(orgDoc);

      const validDto: any = {
        taxId: '0109876543',
        legalCompanyName: 'CÔNG TY TNHH CÔNG NGHỆ KHÁCH HÀNG VIỆT NAM',
        registeredAddress: 'Tòa nhà FPT, Phố Duy Tân, Cầu Giấy, Hà Nội',
        legalRepresentative: 'Trần Văn Mạnh',
        representativeTitle: 'Giám Đốc Điều Hành',
        contactEmail: 'manh.tran@customer.com',
        dataSource: 'VERIFIED_BUSINESS_REGISTRY_API',
      };

      const result = await service.updateLegalProfile('507f1f77bcf86cd799439011', validDto, 'user_123');

      expect(orgDoc.save).toHaveBeenCalled();
      expect(result.legalProfile?.verificationStatus).toBe('TAX_VERIFIED');
      expect(mockAuditRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ORGANIZATION_LEGAL_PROFILE_UPDATED',
          resourceType: 'Organization',
        }),
      );
    });
  });
});
