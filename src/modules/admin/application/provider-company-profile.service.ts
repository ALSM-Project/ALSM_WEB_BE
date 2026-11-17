import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ProviderCompanyProfile,
  ProviderCompanyProfileDocument,
} from '../infrastructure/provider-company-profile.schema';
import { UpdateProviderCompanyProfileDto } from '../presentation/dto/provider-company-profile.dto';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';

export const DEFAULT_ALSM_PROVIDER_PROFILE = {
  version: 1,
  isActive: true,
  legalName: 'CÔNG TY CỔ PHẦN CÔNG NGHỆ HIỆN ĐẠI HÓA PHẦN MỀM ALSM',
  taxId: '0110892345',
  registeredAddress:
    'Tầng 12, Tòa nhà Keangnam Landmark 72, Đường Phạm Hùng, Phường Mễ Trì, Quận Nam Từ Liêm, TP. Hà Nội, Việt Nam',
  businessRegistrationNumber: '0110892345',
  representativeName: 'Nguyễn Hữu Dũng',
  representativeTitle: 'Tổng Giám Đốc',
  contactEmail: 'contracts@alsm.io',
  contactPhone: '+84 24 7300 8899',
  bankName: 'Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)',
  bankAccountNumber: '1029384756',
  bankAccountHolder: 'CONG TY CP CONG NGHE HIEN DAI HOA PHAN MEM ALSM',
  companyLogo: '/assets/logo.png',
  signatoryConfig: {
    signerName: 'Nguyễn Hữu Dũng',
    signerTitle: 'Tổng Giám Đốc',
    signerEmail: 'contracts@alsm.io',
    digitalCertificateProvider: 'VNPT-CA',
    certificateSerialNumber: 'VNPT-ECA-ALSM-01',
    autoCounterSignEnabled: true,
    signatureImageUrl: '',
    companySealUrl: '',
    signatureType: 'drawn',
    stampPosition: 'overlap',
    signingMethod: 'cloud_ca',
    certificateStatus: 'active',
    certificateValidUntil: '2027-12-31',
  },
  changeReason: 'Initial verified legal entity configuration',
};

@Injectable()
export class ProviderCompanyProfileService {
  private readonly logger = new Logger(ProviderCompanyProfileService.name);

  constructor(
    @InjectModel(ProviderCompanyProfile.name)
    private readonly profileModel: Model<ProviderCompanyProfileDocument>,
    @Inject(AUDIT_REPOSITORY)
    private readonly auditRepo: AuditRepository,
  ) {}

  /**
   * Retrieves the currently active Provider Legal Profile.
   * If no profile exists in MongoDB, seeds and returns the default official ALSM profile.
   */
  async getActiveProfile(): Promise<ProviderCompanyProfileDocument> {
    let active = await this.profileModel.findOne({ isActive: true }).sort({ version: -1 });

    if (!active) {
      this.logger.log('No active ProviderCompanyProfile found in database. Initializing default...');
      active = await this.profileModel.create({
        ...DEFAULT_ALSM_PROVIDER_PROFILE,
      });
    }

    return active;
  }

  /**
   * Lists all historical versions of the company profile.
   */
  async getProfileVersions(): Promise<ProviderCompanyProfileDocument[]> {
    return this.profileModel.find().sort({ version: -1 }).exec();
  }

  /**
   * Updates the provider legal profile, creating a new immutable version and logging an audit event.
   */
  async updateProfile(
    dto: UpdateProviderCompanyProfileDto,
    actorUserId?: string,
    actorEmail?: string,
    ipAddress?: string,
  ): Promise<ProviderCompanyProfileDocument> {
    this.validateProfileData(dto);

    const currentActive = await this.getActiveProfile();
    const nextVersion = (currentActive.version || 1) + 1;

    // Archive current active profile
    await this.profileModel.updateMany({ isActive: true }, { $set: { isActive: false } });

    // Create new active version
    const newProfile = await this.profileModel.create({
      version: nextVersion,
      isActive: true,
      legalName: dto.legalName.trim(),
      taxId: dto.taxId.trim(),
      registeredAddress: dto.registeredAddress.trim(),
      businessRegistrationNumber: dto.businessRegistrationNumber?.trim() || dto.taxId.trim(),
      representativeName: dto.representativeName.trim(),
      representativeTitle: dto.representativeTitle.trim(),
      contactEmail: dto.contactEmail.trim().toLowerCase(),
      contactPhone: dto.contactPhone?.trim(),
      bankName: dto.bankName.trim(),
      bankAccountNumber: dto.bankAccountNumber.trim(),
      bankAccountHolder: dto.bankAccountHolder.trim(),
      companyLogo: dto.companyLogo?.trim() || currentActive.companyLogo,
      signatoryConfig: {
        signerName: dto.signatoryConfig.signerName.trim(),
        signerTitle: dto.signatoryConfig.signerTitle.trim(),
        signerEmail: dto.signatoryConfig.signerEmail.trim().toLowerCase(),
        digitalCertificateProvider: dto.signatoryConfig.digitalCertificateProvider?.trim() || 'VNPT-CA',
        certificateSerialNumber: dto.signatoryConfig.certificateSerialNumber?.trim() || 'VNPT-ECA-ALSM-01',
        autoCounterSignEnabled: dto.signatoryConfig.autoCounterSignEnabled ?? true,
        signatureImageUrl: dto.signatoryConfig.signatureImageUrl?.trim() ?? currentActive.signatoryConfig?.signatureImageUrl ?? '',
        companySealUrl: dto.signatoryConfig.companySealUrl?.trim() ?? currentActive.signatoryConfig?.companySealUrl ?? '',
        signatureType: dto.signatoryConfig.signatureType?.trim() || currentActive.signatoryConfig?.signatureType || 'drawn',
        stampPosition: dto.signatoryConfig.stampPosition?.trim() || currentActive.signatoryConfig?.stampPosition || 'overlap',
        signingMethod: dto.signatoryConfig.signingMethod?.trim() || currentActive.signatoryConfig?.signingMethod || 'cloud_ca',
        certificateStatus: dto.signatoryConfig.certificateStatus?.trim() || currentActive.signatoryConfig?.certificateStatus || 'active',
        certificateValidUntil: dto.signatoryConfig.certificateValidUntil?.trim() || currentActive.signatoryConfig?.certificateValidUntil || '2027-12-31',
      },
      updatedByUserId:
        actorUserId && Types.ObjectId.isValid(actorUserId)
          ? new Types.ObjectId(actorUserId)
          : undefined,
      updatedByEmail: actorEmail,
      changeReason: dto.changeReason?.trim() || `Administrative legal profile update v${nextVersion}`,
    });

    // Write audit log
    try {
      await this.auditRepo.append({
        action: 'COMPANY_LEGAL_PROFILE_UPDATED',
        resourceType: 'ProviderCompanyProfile',
        resourceId: newProfile._id.toString(),
        actorUserId,
        metadata: {
          version: String(nextVersion),
          legalName: newProfile.legalName,
          taxId: newProfile.taxId,
          representativeName: newProfile.representativeName,
          changeReason: newProfile.changeReason || '',
          ...(ipAddress ? { ipAddress } : {}),
        },
      });
    } catch (auditErr: any) {
      this.logger.warn(`Failed to write audit log for legal profile update: ${auditErr?.message}`);
    }

    this.logger.log(`ProviderCompanyProfile upgraded to v${nextVersion} by user: ${actorEmail || actorUserId}`);
    return newProfile;
  }

  private validateProfileData(dto: UpdateProviderCompanyProfileDto): void {
    if (!dto.legalName || dto.legalName.trim().length < 3) {
      throw new BadRequestException('Legal Company Name must be at least 3 characters.');
    }

    const cleanTaxId = dto.taxId.replace(/[\s-]/g, '');
    if (!/^[0-9]{10}([0-9]{3})?$/.test(cleanTaxId)) {
      throw new BadRequestException(
        'Invalid Tax ID format. Standard enterprise tax code must consist of 10 or 13 digits.',
      );
    }

    if (!dto.registeredAddress || dto.registeredAddress.trim().length < 10) {
      throw new BadRequestException('Registered Address must be a comprehensive legal address.');
    }

    // Ensure representative name is not an account username or placeholder
    const rep = dto.representativeName.trim().toLowerCase();
    if (
      /^[a-z0-9_-]{3,24}$/.test(rep) &&
      (/[0-9]/.test(rep) || !rep.includes(' '))
    ) {
      throw new BadRequestException(
        'Legal representative name must be a full personal name, not a system username or account handle.',
      );
    }

    if (!dto.bankName || !dto.bankAccountNumber || !dto.bankAccountHolder) {
      throw new BadRequestException('Bank Name, Account Number, and Account Holder are mandatory.');
    }

    if (!dto.signatoryConfig?.signerName || !dto.signatoryConfig?.signerEmail) {
      throw new BadRequestException('Contract Signatory configuration is required.');
    }
  }
}
