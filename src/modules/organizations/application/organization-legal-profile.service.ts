import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Organization, OrganizationDocument } from '../infrastructure/organization.schema';
import {
  ITaxLookupProvider,
  TAX_LOOKUP_PROVIDER,
  TaxLookupResult,
  TaxLookupStatus,
} from '../domain/tax-lookup-provider.port';
import { UpdateOrganizationLegalProfileDto } from '../presentation/dto/organization-legal-profile.dto';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';

@Injectable()
export class OrganizationLegalProfileService {
  private readonly logger = new Logger(OrganizationLegalProfileService.name);

  constructor(
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    @Inject(TAX_LOOKUP_PROVIDER)
    private readonly taxLookupProvider: ITaxLookupProvider,
    @Inject(AUDIT_REPOSITORY)
    private readonly auditRepo: AuditRepository,
  ) {}

  getTaxLookupStatus(): TaxLookupStatus {
    return this.taxLookupProvider.getStatus();
  }

  async lookupTaxId(taxId: string): Promise<TaxLookupResult> {
    return this.taxLookupProvider.lookup(taxId);
  }

  private async resolveOrganization(orgId: string, userId?: string): Promise<OrganizationDocument> {
    if (orgId && orgId !== 'current' && orgId !== 'me' && Types.ObjectId.isValid(orgId)) {
      const org = await this.orgModel.findById(orgId);
      if (org) return org;
    }

    if (userId) {
      const userObjId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;
      let org = await this.orgModel.findOne({
        $or: [
          ...(userObjId ? [{ 'members.userId': userObjId }] : []),
          { 'members.userId': userId },
        ],
      });
      if (org) return org;

      const newOrg = await this.orgModel.create({
        name: 'My Organization',
        type: 'SELF_SERVICE',
        members: [{ userId: userObjId || userId, role: 'OWNER' }],
      });
      return newOrg;
    }

    throw new NotFoundException(`Organization not found: ${orgId}`);
  }

  async getLegalProfile(organizationId: string, userId?: string) {
    const org = await this.resolveOrganization(organizationId, userId);

    return {
      organizationId: org._id.toString(),
      organizationName: org.name,
      legalProfile: org.legalProfile || {
        taxId: '',
        legalCompanyName: org.name,
        registeredAddress: '',
        legalRepresentative: '',
        representativeTitle: '',
        contactEmail: (org as any).contactEmail || '',
        companyStatus: 'ACTIVE',
        dataSource: 'MANUAL_ENTRY',
        verificationStatus: 'UNVERIFIED',
      },
    };
  }

  async updateLegalProfile(
    organizationId: string,
    dto: UpdateOrganizationLegalProfileDto,
    actorUserId?: string,
    ipAddress?: string,
  ) {
    this.validateLegalProfileInput(dto);

    const org = await this.resolveOrganization(organizationId, actorUserId);

    const verificationStatus =
      dto.verificationStatus ||
      (dto.dataSource === 'VERIFIED_BUSINESS_REGISTRY_API' ? 'TAX_VERIFIED' : 'UNVERIFIED');

    const updatedLegalProfile = {
      taxId: dto.taxId.trim(),
      legalCompanyName: dto.legalCompanyName.trim(),
      registeredAddress: dto.registeredAddress.trim(),
      businessRegistrationNumber: dto.businessRegistrationNumber?.trim() || dto.taxId.trim(),
      legalRepresentative: dto.legalRepresentative.trim(),
      representativeTitle: dto.representativeTitle.trim(),
      contactEmail: dto.contactEmail.trim().toLowerCase(),
      contactPhone: dto.contactPhone?.trim(),
      companyStatus: dto.companyStatus?.trim() || 'ACTIVE',
      dataSource: dto.dataSource?.trim() || 'MANUAL_ENTRY',
      lookupTimestamp: dto.lookupTimestamp || (dto.dataSource ? new Date() : undefined),
      verificationStatus,
      verifiedAt: verificationStatus !== 'UNVERIFIED' ? new Date() : undefined,
      notes: dto.notes?.trim(),
    };

    org.legalProfile = updatedLegalProfile as any;
    await org.save();

    // Audit log
    try {
      await this.auditRepo.append({
        action: 'ORGANIZATION_LEGAL_PROFILE_UPDATED',
        resourceType: 'Organization',
        resourceId: org._id.toString(),
        organizationId: org._id.toString(),
        actorUserId,
        metadata: {
          organizationName: org.name,
          legalCompanyName: updatedLegalProfile.legalCompanyName,
          taxId: updatedLegalProfile.taxId,
          legalRepresentative: updatedLegalProfile.legalRepresentative,
          verificationStatus,
          dataSource: updatedLegalProfile.dataSource,
          ...(ipAddress ? { ipAddress } : {}),
        },
      });
    } catch (auditErr: any) {
      this.logger.warn(`Failed to log audit for organization legal profile: ${auditErr?.message}`);
    }

    return {
      organizationId: org._id.toString(),
      organizationName: org.name,
      legalProfile: org.legalProfile,
    };
  }

  private validateLegalProfileInput(dto: UpdateOrganizationLegalProfileDto): void {
    const cleanTax = dto.taxId.replace(/[\s-]/g, '');
    if (!/^[0-9]{10}([0-9]{3})?$/.test(cleanTax)) {
      throw new BadRequestException(
        'Invalid Tax Identification Number format. Standard Vietnam enterprise Tax ID is 10 or 13 digits.',
      );
    }

    if (!dto.legalCompanyName || dto.legalCompanyName.trim().length < 3) {
      throw new BadRequestException('Legal Company Name must be at least 3 characters.');
    }

    if (!dto.registeredAddress || dto.registeredAddress.trim().length < 3) {
      throw new BadRequestException('Registered headquarters address is required.');
    }

    const rep = dto.legalRepresentative.trim().toLowerCase();
    if (
      /^[a-z0-9_-]{3,24}$/.test(rep) &&
      (/[0-9]/.test(rep) || !rep.includes(' '))
    ) {
      throw new BadRequestException(
        'Legal representative name must be a full personal name, not an account handle or login username.',
      );
    }
  }
}
