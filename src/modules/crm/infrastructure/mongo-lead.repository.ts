import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { ClientSession, Connection, HydratedDocument, Model, Types } from 'mongoose';
import { requireActiveTransaction } from '../../../shared/database/mongo-transaction-runner';
import {
  CreateLead,
  LeadAssignment,
  LeadConversion,
  AddLeadContractInput,
  AddLeadContractResult,
  LeadContractRecord,
  LeadRecord,
  LeadRepository,
  LeadStatus,
} from '../domain/lead.types';
import { Lead } from './lead.schema';

@Injectable()
export class MongoLeadRepository implements LeadRepository {
  constructor(@InjectModel(Lead.name) private readonly model: Model<Lead>) {}
  private session?: ClientSession;
  private transaction?: object;
  inTransaction(session: ClientSession, connection: Connection) {
    requireActiveTransaction(session);
    if (this.model.db !== connection) throw new Error('Lead transaction connection mismatch');
    const participant = new MongoLeadRepository(this.model);
    participant.session = session;
    participant.transaction = session.transaction;
    return participant;
  }
  private scope() {
    if (this.session) {
      requireActiveTransaction(this.session);
      if (this.transaction !== this.session.transaction)
        throw new Error('Stale lead transaction participant');
    }
    return this.session ?? null;
  }
  async findById(id: string, organizationId: string) {
    const doc = await this.model
      .findOne({ _id: new Types.ObjectId(id), organizationId: new Types.ObjectId(organizationId) })
      .session(this.scope())
      .exec();
    return doc ? this.map(doc) : null;
  }
  async create(input: CreateLead) {
    if (!this.session) throw new Error('Lead writes require the audited atomic unit of work');
    this.scope();
    await this.model.init();
    const unique = (await this.model.collection.indexes()).find(
      (index) => index.name === 'one_lead_per_source_reference',
    );
    if (
      !unique?.unique ||
      JSON.stringify(unique.key) !== JSON.stringify({ organizationId: 1, sourceReference: 1 })
    )
      throw new ServiceUnavailableException({
        code: 'LEAD_SOURCE_INDEX_REQUIRED',
        message: 'The organization-scoped lead source uniqueness index must be provisioned',
      });
    const creationFingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          input.organizationId,
          input.actorUserId,
          input.title,
          input.sourceReference,
          input.contactEmail ?? null,
          input.assignment.id,
          input.assignment.teamId,
          input.assignment.salespersonId,
        ]),
      )
      .digest('hex');
    const existing = await this.model
      .findById(new Types.ObjectId(input.leadId))
      .session(this.scope())
      .exec();
    if (existing) {
      if (
        String(existing.organizationId) !== input.organizationId ||
        existing.creationFingerprint !== creationFingerprint
      )
        throw new ConflictException({
          code: 'LEAD_ID_CONFLICT',
          message: 'Lead ID was already used for a different request',
        });
      return { ...this.map(existing), replayed: true };
    }
    if (
      await this.model
        .exists({
          organizationId: new Types.ObjectId(input.organizationId),
          sourceReference: input.sourceReference,
        })
        .session(this.scope())
    )
      throw new ConflictException({
        code: 'LEAD_SOURCE_REFERENCE_EXISTS',
        message: 'This sourced lead is already recorded; reconcile the existing record',
      });
    const [created] = await this.model.create(
      [
        {
          _id: new Types.ObjectId(input.leadId),
          organizationId: new Types.ObjectId(input.organizationId),
          status: LeadStatus.ASSIGNED,
          title: input.title,
          sourceReference: input.sourceReference,
          contactEmail: input.contactEmail,
          creationFingerprint,
          revision: 1,
          assignments: [input.assignment],
        },
      ],
      { session: this.scope() },
    );
    return this.map(created);
  }
  async assign(id: string, organizationId: string, assignment: LeadAssignment) {
    if (!this.session) throw new Error('Lead writes require the audited atomic unit of work');
    const existing = await this.findById(id, organizationId);
    const previous = existing?.assignments.find((item) => item.id === assignment.id);
    if (previous) {
      if (
        previous.teamId !== assignment.teamId ||
        previous.salespersonId !== assignment.salespersonId ||
        previous.actorUserId !== assignment.actorUserId ||
        previous.expectedRevision !== assignment.expectedRevision
      )
        throw new ConflictException({
          code: 'LEAD_ASSIGNMENT_ID_CONFLICT',
          message: 'Assignment ID already identifies another operation',
        });
      return { ...existing!, replayed: true };
    }
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          revision: assignment.expectedRevision,
        },
        { $push: { assignments: assignment }, $inc: { revision: 1 } },
        { new: true, runValidators: true },
      )
      .session(this.scope())
      .exec();
    return doc ? this.map(doc) : null;
  }
  async convert(
    id: string,
    organizationId: string,
    expectedRevision: number,
    conversion: LeadConversion,
  ) {
    if (!this.session) throw new Error('Lead writes require the audited atomic unit of work');
    const existing = await this.findById(id, organizationId);
    if (existing?.conversion) {
      const prior = existing.conversion;
      if (
        prior.id !== conversion.id ||
        prior.customerUserId !== conversion.customerUserId ||
        prior.reference !== conversion.reference ||
        prior.actorUserId !== conversion.actorUserId
      )
        throw new ConflictException({
          code: 'LEAD_ALREADY_CONVERTED',
          message: 'The retained customer conversion cannot be replaced',
        });
      return { ...existing, replayed: true };
    }
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          revision: expectedRevision,
          conversion: { $exists: false },
        },
        { $set: { conversion, status: LeadStatus.CONVERTED }, $inc: { revision: 1 } },
        { new: true, runValidators: true },
      )
      .session(this.scope())
      .exec();
    return doc ? this.map(doc) : null;
  }

  async addContract(input: AddLeadContractInput): Promise<AddLeadContractResult | null> {
    if (!this.session) throw new Error('Contract writes require the audited atomic unit of work');
    this.scope();
    if (!Types.ObjectId.isValid(input.leadId)) return null;

    const doc = await this.model
      .findById(new Types.ObjectId(input.leadId))
      .session(this.scope())
      .exec();
    if (!doc) return null;

    const existing = (doc.contracts || []).find((contract) => contract.requestId === input.requestId) as
      | LeadContractRecord
      | undefined;
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'This request ID was already used for different contract details.',
        });
      }
      return { lead: this.map(doc), contract: existing, replayed: true };
    }

    if (doc.stage === 'LOST') {
      throw new BadRequestException({ code: 'LEAD_NOT_CONTRACTABLE', message: 'A contract cannot be created for a lost lead.' });
    }

    if (input.contract.quoteId) {
      const quote = (doc.quotes || []).find((item) => String(item.id) === input.contract.quoteId) as
        | Record<string, unknown>
        | undefined;
      if (!quote) {
        throw new NotFoundException({ code: 'CONTRACT_QUOTE_NOT_FOUND', message: 'The selected quote was not found on this lead.' });
      }
      if (quote.status !== 'ACCEPTED') {
        throw new BadRequestException({ code: 'CONTRACT_QUOTE_NOT_ACCEPTED', message: 'The selected quote must be accepted before creating a contract.' });
      }
      const quotedPlan = String(quote.planName ?? quote.plan ?? '');
      const quotedAmount = Number(quote.finalPrice ?? quote.amount);
      const discountPercent = Number(quote.discountPercent ?? 0);
      const finalAmount = Math.round(quotedAmount * (1 - discountPercent / 100));
      if (input.contract.plan !== quotedPlan || input.contract.annualValue !== finalAmount) {
        throw new BadRequestException({
          code: 'CONTRACT_QUOTE_MISMATCH',
          message: 'Contract plan and value must match the accepted quote.',
        });
      }
    }

    const companyPrefix = String(doc.company ?? doc.companyName ?? 'ALSM')
      .replace(/[^a-z\d]/gi, '')
      .slice(0, 4)
      .toUpperCase()
      .padEnd(4, 'X');
    const contractNumber = `CTR-${input.contract.createdAt.getUTCFullYear()}-${companyPrefix}-${String((doc.contracts || []).length + 1).padStart(4, '0')}`;
    const contract: LeadContractRecord = {
      ...input.contract,
      requestId: input.requestId,
      requestFingerprint: input.requestFingerprint,
      contractNumber,
    };
    const updated = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(input.leadId), 'contracts.requestId': { $ne: input.requestId } },
        { $push: { contracts: contract }, $set: { updatedAt: contract.createdAt } },
        { new: true, runValidators: true },
      )
      .session(this.scope())
      .exec();
    if (!updated) {
      throw new ConflictException({ code: 'LEAD_CHANGED', message: 'The lead changed while the contract was being created. Refresh and try again.' });
    }

    return {
      lead: this.map(updated),
      contract,
      replayed: false,
    };
  }

  private map(doc: HydratedDocument<Lead>): LeadRecord {
    return {
      id: String(doc._id),
      organizationId: String(doc.organizationId),
      status: doc.status,
      title: doc.title,
      sourceReference: doc.sourceReference,
      contactEmail: doc.contactEmail,
      revision: doc.revision,
      activeAssignment: {
        ...doc.assignments[doc.assignments.length - 1],
        startedAt: new Date(doc.assignments[doc.assignments.length - 1].startedAt),
      },
      assignments: doc.assignments.map((assignment) => ({
        ...assignment,
        startedAt: new Date(assignment.startedAt),
      })),
      conversion: doc.conversion
        ? { ...doc.conversion, convertedAt: new Date(doc.conversion.convertedAt) }
        : undefined,
      contactName: doc.contactName,
      company: doc.company,
      phone: doc.phone,
      source: doc.source,
      stage: doc.stage,
      score: doc.score,
      lastContactAt: doc.lastContactAt,
      notes: doc.notes,
      interactions: doc.interactions,
      demos: doc.demos,
      quotes: doc.quotes,
      contracts: doc.contracts,
      assignedTo: doc.assignedTo,
    };
  }
}
