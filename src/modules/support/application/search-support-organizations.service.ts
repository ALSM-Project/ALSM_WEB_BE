import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  SUPPORT_ORGANIZATION_DIRECTORY,
  SupportOrganizationDirectory,
  SupportOrganizationSearch,
} from '../../organizations/domain/support-organization-directory.port';
import { SUPPORT_CLOCK, SupportClock, SupportPrincipal } from './support-context.ports';
import { supportIdentifier, supportUnavailable } from './support-context.errors';
import { SupportStaffAccessService } from './support-staff-access.service';

@Injectable()
export class SearchSupportOrganizationsService {
  constructor(
    private readonly access: SupportStaffAccessService,
    @Inject(SUPPORT_ORGANIZATION_DIRECTORY)
    private readonly organizations: SupportOrganizationDirectory,
    @Inject(SUPPORT_CLOCK) private readonly clock: SupportClock,
  ) {}

  async execute(principal: SupportPrincipal, query: SupportOrganizationSearch) {
    const actor = { ...principal };
    const input = { ...query, query: typeof query.query === 'string' ? query.query.trim() : '' };
    if (
      !['name', 'email'].includes(input.field) ||
      input.query.length < 3 ||
      input.query.length > 120 ||
      /\p{Cc}/u.test(input.query) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 25
    )
      throw new BadRequestException({
        code: 'INVALID_SUPPORT_SEARCH',
        message: 'Provide a bounded name or email search',
      });
    if (input.afterId) supportIdentifier(input.afterId);
    const admission = await this.access.require(actor, this.clock.now());
    let rows;
    try {
      rows = await this.organizations.search(input, this.clock.now());
    } catch {
      throw supportUnavailable();
    }
    await this.access.recheck(actor, admission, this.clock.now());
    return {
      items: rows
        .slice(0, input.limit)
        .map(({ id, name, type, status }) => ({ id, name, type, status })),
      nextAfterId: rows.length > input.limit ? rows[input.limit - 1].id : null,
    };
  }
}
