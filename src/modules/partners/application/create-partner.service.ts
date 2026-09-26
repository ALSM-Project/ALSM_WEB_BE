import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { CreatePartnerInput, PARTNER_REPOSITORY, PartnerRecord, PartnerRepository } from '../domain/partner.types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CreatePartnerRequest = Omit<CreatePartnerInput, 'createdBy'>;

@Injectable()
export class CreatePartnerService {
  constructor(
    @Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(userId: string, input: CreatePartnerRequest): Promise<PartnerRecord> {
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException({ code: 'PARTNER_NAME_REQUIRED', message: 'Partner name is required' });
    }

    const contactEmail = input.contactEmail?.trim().toLowerCase();
    if (!contactEmail || !EMAIL_PATTERN.test(contactEmail)) {
      throw new BadRequestException({ code: 'INVALID_CONTACT_EMAIL', message: 'A valid contact email is required' });
    }

    const existing = await this.partners.findByEmail(contactEmail);
    if (existing) {
      throw new ConflictException({
        code: 'PARTNER_ALREADY_EXISTS',
        message: `A partner with contact email '${contactEmail}' already exists`,
      });
    }

    const partner = await this.partners.create({
      name,
      contactEmail,
      contactPhone: input.contactPhone?.trim() || undefined,
      website: input.website?.trim() || undefined,
      address: input.address?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      createdBy: userId,
    });

    await this.audit.append({
      actorUserId: userId,
      action: 'PARTNER_CREATED',
      resourceType: 'PARTNER',
      resourceId: partner.id,
    });

    return partner;
  }
}
