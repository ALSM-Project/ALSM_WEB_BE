import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PARTNER_REPOSITORY, PartnerRecord, PartnerRepository } from '../domain/partner.types';

@Injectable()
export class GetPartnerService {
  constructor(@Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository) {}

  async execute(partnerId: string): Promise<PartnerRecord> {
    const partner = await this.partners.findById(partnerId);
    if (!partner) {
      throw new NotFoundException({ code: 'PARTNER_NOT_FOUND', message: `Partner '${partnerId}' not found` });
    }
    return partner;
  }
}
