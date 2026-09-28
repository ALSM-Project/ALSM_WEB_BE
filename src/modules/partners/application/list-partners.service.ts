import { Inject, Injectable } from '@nestjs/common';
import { PARTNER_REPOSITORY, PartnerRecord, PartnerRepository } from '../domain/partner.types';

@Injectable()
export class ListPartnersService {
  constructor(@Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository) {}

  async execute(): Promise<PartnerRecord[]> {
    return this.partners.list();
  }
}
