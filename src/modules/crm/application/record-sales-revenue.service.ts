import { Inject, Injectable } from '@nestjs/common';
import {
  SALES_TEAM_ADMINISTRATION,
  SalesTeamAdministration,
} from '../../teams/domain/sales-team-administration.port';
import { SALES_UNIT_OF_WORK, SalesUnitOfWork } from './sales-unit-of-work.port';
import { evidenceReference, salesId } from './sales-validation';
export interface RecordSalesRevenueCommand {
  paymentId: string;
  teamId: string;
  salespersonId: string;
  evidenceReference: string;
}
@Injectable()
export class RecordSalesRevenueService {
  constructor(
    @Inject(SALES_TEAM_ADMINISTRATION) private readonly access: SalesTeamAdministration,
    @Inject(SALES_UNIT_OF_WORK) private readonly atomic: SalesUnitOfWork,
  ) {}
  async execute(
    userId: string,
    organizationHeader: string | undefined,
    command: RecordSalesRevenueCommand,
  ) {
    const paymentId = salesId(command.paymentId),
      teamId = salesId(command.teamId),
      salespersonId = salesId(command.salespersonId),
      reference = evidenceReference(command.evidenceReference);
    const { organizationId } = await this.access.authorize(
      userId,
      organizationHeader,
      teamId,
      salespersonId,
    );
    return this.atomic.run(async (repositories) => {
      const result = await repositories.revenue.record({
        paymentId,
        organizationId,
        teamId,
        salespersonId,
        actorUserId: userId,
        evidenceReference: reference,
        recordedAt: new Date(),
      });
      await repositories.audit.append({
        actorUserId: userId,
        organizationId,
        action: 'CONFIRMED_PAYMENT_SALESPERSON_RECORDED',
        resourceType: 'payment',
        resourceId: paymentId,
        metadata: { teamId, salespersonId },
      });
      return result;
    }, paymentId);
  }
}
