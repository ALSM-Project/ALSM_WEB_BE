import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import {
  CreatePartnerInput,
  DuplicatePartnerEmailError,
  PARTNER_NAME_MAX_LENGTH,
  PARTNER_REPOSITORY,
  PartnerRecord,
  PartnerRepository,
} from '../domain/partner.types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export type CreatePartnerRequest = Omit<CreatePartnerInput, 'createdBy'>;

@Injectable()
export class CreatePartnerService {
  constructor(
    @Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(userId: string, input: CreatePartnerRequest): Promise<PartnerRecord> {
    const name = input.name?.trim();
    if (!name || name.length > PARTNER_NAME_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'PARTNER_NAME_REQUIRED',
        message: `Partner name is required and must be at most ${PARTNER_NAME_MAX_LENGTH} characters`,
      });
    }

    const contactEmail = input.contactEmail?.trim().toLowerCase();
    if (!contactEmail || !EMAIL_PATTERN.test(contactEmail)) {
      throw new BadRequestException({
        code: 'INVALID_CONTACT_EMAIL',
        message: 'A valid contact email is required',
      });
    }

    const contactName = input.contactName?.trim();
    if (!contactName) {
      throw new BadRequestException({
        code: 'CONTACT_NAME_REQUIRED',
        message: 'Contact name is required',
      });
    }

    const primaryDomain = input.primaryDomain?.trim().toLowerCase();
    if (!primaryDomain || !DOMAIN_PATTERN.test(primaryDomain)) {
      throw new BadRequestException({
        code: 'INVALID_PRIMARY_DOMAIN',
        message: 'A valid primary domain is required (e.g. partner.com)',
      });
    }

    if (await this.partners.findByEmail(contactEmail)) {
      throw this.duplicate(contactEmail);
    }

    let partner: PartnerRecord;
    try {
      partner = await this.partners.create({
        name,
        contactEmail,
        contactName,
        primaryDomain,
        engagementType: input.engagementType?.trim() || undefined,
        assignedStaffName: input.assignedStaffName?.trim() || undefined,
        createdBy: userId,
      });
    } catch (error) {
      // Two identical requests can both pass findByEmail; the unique index decides.
      if (error instanceof DuplicatePartnerEmailError) throw this.duplicate(contactEmail);
      throw error;
    }

    // Only reached once the partner is persisted - a failed create never writes an audit entry.
    await this.audit.append({
      actorUserId: userId,
      action: 'PARTNER_CREATED',
      resourceType: 'PARTNER',
      resourceId: partner.id,
      metadata: {
        partnerName: partner.name,
        contactEmail: partner.contactEmail,
      },
    });

    return partner;
  }

  private duplicate(contactEmail: string): ConflictException {
    return new ConflictException({
      code: 'PARTNER_ALREADY_EXISTS',
      message: `A partner with contact email '${contactEmail}' already exists`,
    });
  }
}
