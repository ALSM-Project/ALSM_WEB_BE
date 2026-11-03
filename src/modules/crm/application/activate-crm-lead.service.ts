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
import { Lead } from '../infrastructure/lead.schema';
import { ContractAggregate, ContractVersion } from '../infrastructure/contract-aggregate.schema';
import { LeadStatus } from '../domain/lead.types';
import { SalesCrmService } from './sales-crm.service';
import { calculateFinalEvidenceManifestSha256 } from '../domain/contract-final-evidence';

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
    @InjectModel(ContractAggregate.name) private readonly contracts: Model<ContractAggregate>,
    @InjectModel(ContractVersion.name) private readonly contractVersions: Model<ContractVersion>,
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

        const signedContract = await this.contracts.findOne({
          leadId: lead._id,
          lifecycleStatus: 'COMPLETED',
          providerCompletionStatus: 'CONFIRMED',
          archiveStatus: 'VERIFIED',
          activationStatus: 'ELIGIBLE',
          customerUserId: { $exists: true },
          'finalEvidence.contractVersionId': { $exists: true },
          'finalEvidence.manifestSha256': { $type: 'string' },
          'finalEvidence.signedPdf.kind': 'SIGNED_PDF',
          'finalEvidence.signedPdf.mimeType': 'application/pdf',
          'finalEvidence.signedPdf.encryption': 'AES-256-GCM',
          'finalEvidence.signedPdf.encryptionKeyVersion': 'v1',
          'finalEvidence.signedPdf.sha256': { $type: 'string' },
          'finalEvidence.signedPdf.storageReference': { $type: 'string' },
          'finalEvidence.providerKey': { $type: 'string' },
          'finalEvidence.providerEnvelopeReference': { $type: 'string' },
          'finalEvidence.providerCompletionEventReference': { $type: 'string' },
        }).sort({ completedAt: -1 }).session(activeSession).exec();
        if (!signedContract) {
          throw new BadRequestException({
            code: 'VERIFIED_CONTRACT_AND_EVIDENCE_REQUIRED',
            message: 'A provider-confirmed contract with verified stored evidence is required before customer activation.',
          });
        }

        const signedVersion = await this.contractVersions.findOne({
          _id: signedContract.currentVersionId,
          contractId: signedContract._id,
        }).session(activeSession).exec();
        if (!signedVersion) {
          throw new ServiceUnavailableException({
            code: 'CONTRACT_VERSION_UNAVAILABLE',
            message: 'The approved contract version could not be verified. Customer activation is blocked.',
          });
        }
        const evidence = signedContract.finalEvidence;
        if (
          !evidence
          || String(evidence.contractVersionId) !== String(signedVersion._id)
          || !signedVersion.canonicalDocument
          || signedVersion.canonicalDocument.kind !== 'CANONICAL_UNSIGNED'
          || evidence.canonicalDocumentSha256 !== signedVersion.canonicalDocument.sha256
          || !evidence.manifestSha256
          || !evidence.providerKey
          || !evidence.providerEnvelopeReference
          || !evidence.providerCompletionEventReference
          || !(evidence.providerCompletedAt instanceof Date)
          || !Number.isFinite(evidence.providerCompletedAt.getTime())
          || !(evidence.archivedAt instanceof Date)
          || !Number.isFinite(evidence.archivedAt.getTime())
          || !(evidence.signedPdf.archivedAt instanceof Date)
          || !Number.isFinite(evidence.signedPdf.archivedAt.getTime())
          || !Array.isArray(evidence.supportingArtifacts)
          || !evidence.supportingArtifacts.every((artifact) => artifact.archivedAt instanceof Date && Number.isFinite(artifact.archivedAt.getTime()))
          || evidence.manifestSha256 !== calculateFinalEvidenceManifestSha256({
            contractVersionId: String(evidence.contractVersionId),
            canonicalDocumentSha256: evidence.canonicalDocumentSha256,
            providerKey: evidence.providerKey,
            providerEnvelopeReference: evidence.providerEnvelopeReference,
            providerCompletionEventReference: evidence.providerCompletionEventReference,
            providerCompletedAt: evidence.providerCompletedAt,
            archivedAt: evidence.archivedAt,
            signedPdf: evidence.signedPdf,
            supportingArtifacts: evidence.supportingArtifacts,
          })
          || !evidence.signedPdf.sha256
          || !evidence.signedPdf.storageReference
          || evidence.signedPdf.kind !== 'SIGNED_PDF'
          || evidence.signedPdf.mimeType !== 'application/pdf'
          || evidence.signedPdf.encryption !== 'AES-256-GCM'
          || evidence.signedPdf.encryptionKeyVersion !== 'v1'
          || evidence.signedPdf.byteLength < 1
        ) {
          throw new BadRequestException({
            code: 'VERIFIED_CONTRACT_EVIDENCE_MANIFEST_REQUIRED',
            message: 'The signed PDF evidence must be archived and bound to the current approved contract version before customer activation.',
          });
        }

        const company = signedVersion.customerName.trim();
        const contactName = signedVersion.customerContactName.trim();
        const email = signedVersion.customerEmail.trim().toLowerCase();
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
          .findOne({ _id: signedContract.customerUserId, email, isEmailVerified: true, isActive: { $ne: false }, isLocked: { $ne: true } })
          .select('_id')
          .session(activeSession)
          .exec();
        if (!customerUser) {
          throw new BadRequestException({
            code: 'VERIFIED_SIGNER_ACCOUNT_REQUIRED',
            message: 'The verified customer account associated with the completed contract is unavailable.',
          });
        }
        const adminLinked = true;
        const members = [{ userId: customerUser._id, role: OrganizationRole.ADMIN }];
        const domain = email.split('@')[1];
        const organization = existingOrganization || (await this.organizations.create([{
          name: company,
          type: OrganizationType.ENTERPRISE,
          status: 'ACTIVE',
          engagementType: signedVersion.plan || 'Enterprise',
          contactEmail: email,
          domain,
          sourceLeadId,
          members,
        }], { session: activeSession }))[0];

        const organizationId = organization._id.toString();
        const convertedAt = new Date();
        const provisioning = {
          status: 'COMPLETED' as const,
          organizationId,
          organizationName: organization.name,
          domain,
          adminEmail: email,
          adminLinked,
          completedAt: convertedAt,
        };
        const expectedRevision = lead.revision;
        const leadFilter: Record<string, unknown> = { _id: lead._id };
        if (typeof expectedRevision === 'number') {
          leadFilter.revision = expectedRevision;
        } else {
          leadFilter.revision = { $exists: false };
        }
        const update = await this.leads.updateOne(
          leadFilter,
          {
            $set: {
              status: LeadStatus.CONVERTED,
              stage: 'WON',
              convertedAt,
              convertedOrganizationId: organization._id,
              provisioning,
              revision: (expectedRevision || 0) + 1,
            },
          },
          { session: activeSession },
        ).exec();
        if (update.matchedCount !== 1) {
          throw new ConflictException({
            code: 'LEAD_CONVERSION_CONFLICT',
            message: 'This lead changed during customer activation. Refresh it and try again.',
          });
        }
        lead.status = LeadStatus.CONVERTED;
        lead.stage = 'WON';
        lead.convertedAt = convertedAt;
        lead.convertedOrganizationId = organization._id;
        lead.provisioning = provisioning;
        lead.revision = (expectedRevision || 0) + 1;
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
