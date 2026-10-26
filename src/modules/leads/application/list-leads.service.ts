import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LEAD_REPOSITORY,
  LeadListParams,
  LeadRecord,
  LeadRepository,
} from '../domain/lead.types';

@Injectable()
export class ListLeadsService {
  private readonly logger = new Logger(ListLeadsService.name);

  constructor(@Inject(LEAD_REPOSITORY) private readonly leads: LeadRepository) {}

  async execute(params?: LeadListParams): Promise<{
    items: LeadRecord[];
    total: number;
    statusCounts: Record<string, number>;
  }> {
    this.logger.log(
      `Listing leads – status=${params?.status ?? 'ALL'}, source=${params?.source ?? 'ALL'}, ` +
      `page=${params?.page ?? 1}, limit=${params?.limit ?? 20}, search=${params?.search ?? ''}`,
    );

    const [result, statusCounts] = await Promise.all([
      this.leads.list(params),
      this.leads.countByStatus(),
    ]);

    return {
      items: result.items,
      total: result.total,
      statusCounts,
    };
  }
}
