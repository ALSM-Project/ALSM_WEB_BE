import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

  async findById(id: string): Promise<LeadRecord> {
    if (!id || !/^[a-f\d]{24}$/i.test(id)) {
      throw new BadRequestException({
        code: 'INVALID_LEAD_ID',
        message: 'Enter a valid lead identifier.',
      });
    }
    const lead = await this.leads.findById(id);
    if (!lead) {
      throw new NotFoundException({
        code: 'LEAD_NOT_FOUND',
        message: 'Lead was not found.',
      });
    }
    return lead;
  }
}

