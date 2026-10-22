import { Inject, Injectable } from '@nestjs/common';
import {
  PARTNER_REPOSITORY,
  PartnerListFilter,
  PartnerRecord,
  PartnerRepository,
} from '../domain/partner.types';

@Injectable()
export class ListPartnersService {
  constructor(@Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository) {}

  /** Newest partners first, optionally filtered by status and a free-text search. */
  async execute(filter: PartnerListFilter = {}): Promise<PartnerRecord[]> {
    return this.partners.list(filter);
  }
}
