import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditLog } from '../../audit/infrastructure/audit-log.schema';
import { Organization } from '../../organizations/infrastructure/organization.schema';
import { OrganizationRole, OrganizationType } from '../../organizations/domain/organization.types';
import { User } from '../../users/infrastructure/user.schema';
import { Lead, LeadDocument } from '../infrastructure/lead.schema';
import { LeadStatus } from '../domain/lead.types';
import { SalesCrmService } from './sales-crm.service';

export interface ActivateCrmLeadResult {
  lead: ReturnType<SalesCrmService['mapLead']>;
  organizationId: string;
  adminLinked: boolean;
  replayed: boolean;
}

@Injectable()
export class ActivateCrmLeadService {
  private readonly logger = new Logger(ActivateCrmLeadService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    @InjectModel(Organization.name) private readonly organizations: Model<Organization>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(AuditLog.name) private readonly audits: Model<AuditLog>,
    private readonly crm: SalesCrmService,
  ) {}

  async execute(actorUserId: string, leadId: string): Promise<ActivateCrmLeadResult> {
    if (!Types.ObjectId.isValid(actorUserId)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'A valid sales user is required.' });
    }
    if (!Types.ObjectId.isValid(leadId)) {
      throw new BadRequestException({ code: 'INVALID_LEAD_ID', message: 'Enter a valid lead identifier.' });
    }

    let session: ClientSession | undefined;
    let result: ActivateCrmLeadResult | undefined;
    try {
      const activeSession = await this.connection.startSession();
      session = activeSession;
      await activeSession.withTransaction(async () => {
        const lead = await this.leads.findById(leadId).session(activeSession).exec();
        if (!lead) {
          throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'This lead could not be found.' });
        }

        if (lead.stage === 'WON' && lead.convertedOrganizationId && lead.provisioning?.status === 'COMPLETED') {
          result = {
            lead: this.crm.mapLead(lead),
            organizationId: lead.convertedOrganizationId.toString(),
            adminLinked: lead.provisioning.adminLinked,
            replayed: true,
          };
          return;
        }
        if (lead.stage === 'WON' || lead.status === LeadStatus.CONVERTED) {
          throw new ConflictException({
            code: 'LEAD_ALREADY_CONVERTED',
            message: 'This lead is already marked as won and needs reconciliation before another conversion.',
          });
        }
        if (lead.stage === 'LOST') {
          throw new BadRequestException({ code: 'LEAD_NOT_CONVERTIBLE', message: 'A lost lead cannot be converted.' });
        }

        const signedContract = (lead.contracts || []).find(
          (contract) => contract.status === 'SIGNED' || contract.status === 'FULLY_SIGNED',
        );
        if (!signedContract) {
          throw new BadRequestException({
            code: 'SIGNED_CONTRACT_REQUIRED',
            message: 'A fully signed contract is required before converting this lead.',
          });
        }

        const company = [lead.company, lead.companyName]
          .find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
        const contactName = typeof lead.contactName === 'string' ? lead.contactName.trim() : '';
        const email = typeof lead.contactEmail === 'string' ? lead.contactEmail.trim().toLowerCase() : '';
        if (!company || company.length > 200) {
          throw new BadRequestException({ code: 'INVALID_CUSTOMER_NAME', message: 'A valid customer organization name is required.' });
        }
        if (!contactName || contactName.length > 120) {
          throw new BadRequestException({ code: 'INVALID_CUSTOMER_CONTACT', message: 'A valid customer contact name is required.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
          throw new BadRequestException({ code: 'INVALID_CUSTOMER_EMAIL', message: 'A valid customer email is required.' });
        }

        const sourceLeadId = new Types.ObjectId(lead._id.toString());
        const existingOrganization = await this.organizations
          .findOne({ sourceLeadId })
          .session(activeSession)
          .exec();
        const customerUser = await this.users
          .findOne({ email, isActive: { $ne: false }, isLocked: { $ne: true } })
          .select('_id')
          .session(activeSession)
          .exec();
        const adminLinked = Boolean(customerUser);
        const members = customerUser
          ? [{ userId: customerUser._id, role: OrganizationRole.ADMIN }]
          : [];
        const domain = email.split('@')[1];
        const organization = existingOrganization || (await this.organizations.create([{
          name: company,
          type: OrganizationType.ENTERPRISE,
          status: 'ACTIVE',
          engagementType: signedContract.plan || 'Enterprise',
          contactEmail: email,
          domain,
          sourceLeadId,
          members,
        }], { session: activeSession }))[0];

        const organizationId = organization._id.toString();
        const convertedAt = new Date();
        lead.status = LeadStatus.CONVERTED;
        lead.stage = 'WON';
        lead.convertedAt = convertedAt;
        lead.convertedOrganizationId = organization._id;
        lead.provisioning = {
          status: 'COMPLETED',
          organizationId,
          organizationName: organization.name,
          domain,
          adminEmail: email,
          adminLinked,
          completedAt: convertedAt,
        };
        lead.revision = (lead.revision || 0) + 1;
        await lead.save({ session: activeSession });
        await this.audits.create([{
          actorUserId: new Types.ObjectId(actorUserId),
          organizationId: lead.organizationId,
          action: 'LEAD_CONVERTED_TO_CUSTOMER',
          resourceType: 'LEAD',
          resourceId: lead.id,
          metadata: {
            customerOrganizationId: organizationId,
            contractId: signedContract.id,
            adminLinked: String(adminLinked),
          },
        }], { session: activeSession });

        result = {
          lead: this.crm.mapLead(lead),
          organizationId,
          adminLinked,
          replayed: false,
        };
      });

      if (!result) {
        throw new ServiceUnavailableException({
          code: 'CUSTOMER_CONVERSION_FAILED',
          message: 'Customer conversion did not finish. No changes were saved; please retry.',
        });
      }
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const mongoCode = (error as { code?: number } | undefined)?.code;
      if (mongoCode === 11000) {
        const settledLead = await this.leads.findById(leadId).exec().catch(() => null);
        if (
          settledLead?.stage === 'WON' &&
          settledLead.convertedOrganizationId &&
          settledLead.provisioning?.status === 'COMPLETED'
        ) {
          return {
            lead: this.crm.mapLead(settledLead),
            organizationId: settledLead.convertedOrganizationId.toString(),
            adminLinked: settledLead.provisioning.adminLinked,
            replayed: true,
          };
        }
        throw new ConflictException({ code: 'LEAD_CONVERSION_CONFLICT', message: 'This lead was converted by another request. Refresh and try again.' });
      }
      this.logger.error('Customer conversion transaction failed.');
      throw new ServiceUnavailableException({
        code: 'CUSTOMER_CONVERSION_FAILED',
        message: 'Customer conversion could not be completed. No changes were saved; please retry later.',
      });
    } finally {
      await session?.endSession().catch(() => undefined);
    }
  }
}
