import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SALES_REVENUE_REPOSITORY,
  SalesRevenueRepository,
} from '../../billing/domain/sales-revenue.port';
import { SalesPerformanceSource } from '../domain/sales-performance-source.port';
import { Lead } from './lead.schema';
import { LeadStatus } from '../domain/lead.types';

@Injectable()
export class MongoSalesPerformanceSource implements SalesPerformanceSource {
  constructor(
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    @Inject(SALES_REVENUE_REPOSITORY) private readonly revenue: SalesRevenueRepository,
  ) {}
  async read(organizationId: string, teamId: string, start: Date, end: Date) {
    const leads = await this.leads
      .find({
        organizationId: new Types.ObjectId(organizationId),
        assignments: { $elemMatch: { teamId, startedAt: { $gte: start, $lt: end } } },
      })
      .select('status assignments conversion')
      .exec();
    return {
      leads: leads.map((lead) => {
        const qualifying = lead.assignments.filter(
          (assignment) =>
            assignment.teamId === teamId &&
            assignment.startedAt >= start &&
            assignment.startedAt < end,
        );
        const conversion = lead.conversion;
        const converted =
          conversion &&
          lead.status === LeadStatus.CONVERTED &&
          conversion.convertedAt < end &&
          qualifying.some(
            (assignment) =>
              assignment.id === conversion.assignmentId &&
              assignment.startedAt <= conversion.convertedAt &&
              assignment.salespersonId === conversion.salespersonId &&
              assignment.teamId === conversion.teamId,
          );
        return {
          leadId: String(lead._id),
          memberIds: [...new Set(qualifying.map((assignment) => assignment.salespersonId))],
          convertedMemberId: converted ? conversion.salespersonId : undefined,
        };
      }),
      revenue: await this.revenue.read(organizationId, teamId, start, end),
    };
  }
}
