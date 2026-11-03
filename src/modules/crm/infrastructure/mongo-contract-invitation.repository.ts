import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { requireActiveTransaction } from '../../../shared/database/mongo-transaction-runner';
import {
  AcceptContractInvitationInput,
  ContractAccessGrantRecord,
  ContractInvitationRecord,
  ContractInvitationRepository,
  CreateContractInvitationInput,
  RotatedContractInvitationInput,
} from '../domain/contract-invitation.types';
import {
  ContractAccessGrant,
  ContractAccessGrantDocument,
  ContractInvitation,
  ContractInvitationDocument,
  PublicInvitationRateLimit,
} from './contract-invitation.schema';

const RESEND_COOLDOWN_MS = 60_000;

@Injectable()
export class MongoContractInvitationRepository implements ContractInvitationRepository, OnApplicationBootstrap {
  private session?: ClientSession;
  private transaction?: object;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ContractInvitation.name)
    private readonly invitations: Model<ContractInvitation>,
    @InjectModel(ContractAccessGrant.name)
    private readonly grants: Model<ContractAccessGrant>,
    @InjectModel(PublicInvitationRateLimit.name)
    private readonly rateLimits: Model<PublicInvitationRateLimit>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await Promise.all([this.invitations.init(), this.grants.init(), this.rateLimits.init()]);
    const [invitationIndexes, grantIndexes, rateLimitIndexes] = await Promise.all([
      this.invitations.collection.indexes(),
      this.grants.collection.indexes(),
      this.rateLimits.collection.indexes(),
    ]);
    const required = [
      invitationIndexes.some((index) => index.key.tokenHash === 1 && index.unique === true),
      invitationIndexes.some((index) => index.name === 'contract_invitation_create_idempotency' && index.unique === true),
      invitationIndexes.some((index) => index.name === 'one_active_contract_invitation_per_lead_email' && index.unique === true),
      grantIndexes.some((index) => index.name === 'one_contract_access_grant_per_user_lead' && index.unique === true),
      rateLimitIndexes.some((index) => index.key.bucketKey === 1 && index.unique === true),
      rateLimitIndexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0),
    ];
    if (required.some((exists) => !exists)) {
      throw new ServiceUnavailableException({
        code: 'CONTRACT_INVITATION_INDEX_UNAVAILABLE',
        message: 'Required invitation, access grant, or rate limit indexes are unavailable; invitation operations cannot start safely.',
      });
    }
  }

  inTransaction(session: ClientSession, connection: Connection): MongoContractInvitationRepository {
    requireActiveTransaction(session);
    if (
      this.connection !== connection ||
      this.invitations.db !== connection ||
      this.grants.db !== connection ||
      this.rateLimits.db !== connection
    ) {
      throw new Error('Contract invitation transaction connection mismatch');
    }
    const participant = new MongoContractInvitationRepository(
      this.connection,
      this.invitations,
      this.grants,
      this.rateLimits,
    );
    participant.session = session;
    participant.transaction = session.transaction;
    return participant;
  }

  private scope(): ClientSession | null {
    if (this.session) {
      requireActiveTransaction(this.session);
      if (this.transaction !== this.session.transaction)
        throw new Error('Stale contract invitation transaction participant');
    }
    return this.session ?? null;
  }

  private requireTransaction(): ClientSession {
    const session = this.scope();
    if (!session) throw new Error('Invitation state changes require the audited transaction unit of work');
    return session;
  }

  async createOrReplay(input: CreateContractInvitationInput) {
    const session = this.requireTransaction();
    const prior = await this.invitations
      .findOne({
        createdByUserId: new Types.ObjectId(input.createdByUserId),
        leadId: new Types.ObjectId(input.leadId),
        organizationId: new Types.ObjectId(input.organizationId),
        createRequestId: input.requestId,
      })
      .session(session)
      .exec();
    if (prior) return { invitation: this.mapInvitation(prior), replayed: true };

    const leadObjectId = new Types.ObjectId(input.leadId);
    const organizationObjectId = new Types.ObjectId(input.organizationId);

    if (await this.invitations.exists({
      leadId: leadObjectId,
      email: input.email,
      status: 'ACTIVE',
      expiresAt: { $gt: input.now },
    }).session(session)) {
      throw new ConflictException({
        code: 'CONTRACT_INVITATION_ALREADY_ACTIVE',
        message: 'An active invitation already exists for this Lead contact. Resend that invitation instead.',
      });
    }

    const [created] = await this.invitations.create([{
        leadId: leadObjectId,
        organizationId: organizationObjectId,
        email: input.email,
        createdByUserId: new Types.ObjectId(input.createdByUserId),
        createRequestId: input.requestId,
        tokenHash: input.tokenHash,
        status: 'ACTIVE',
        deliveryStatus: 'PENDING',
        expiresAt: input.expiresAt,
        lastDeliveryAttemptAt: input.now,
      }], { session });
    return { invitation: this.mapInvitation(created), replayed: false };
  }

  async expireExpiredForLeadEmail(leadId: string, email: string, now: Date) {
    const session = this.requireTransaction();
    const rows = await this.invitations.find({
      leadId: new Types.ObjectId(leadId),
      email,
      status: 'ACTIVE',
      expiresAt: { $lte: now },
    }).select('_id organizationId').session(session).exec();
    const expired: Array<{ id: string; leadId: string; organizationId: string }> = [];
    for (const row of rows) {
      const changed = await this.invitations.updateOne(
        { _id: row._id, status: 'ACTIVE', expiresAt: { $lte: now } },
        { $set: { status: 'EXPIRED' } },
      ).session(session).exec();
      if (changed.modifiedCount === 1) {
        expired.push({ id: row.id, leadId, organizationId: String(row.organizationId) });
      }
    }
    return expired;
  }

  async listForLead(leadId: string, organizationId: string) {
    const rows = await this.invitations
      .find({ leadId: new Types.ObjectId(leadId), organizationId: new Types.ObjectId(organizationId) })
      .sort({ createdAt: -1 })
      .session(this.scope())
      .exec();
    return rows.map((row) => this.mapInvitation(row));
  }

  async findForLead(invitationId: string, leadId: string, organizationId: string) {
    if (!/^[a-f\d]{24}$/i.test(invitationId)) return null;
    const row = await this.invitations.findOne({
      _id: new Types.ObjectId(invitationId),
      leadId: new Types.ObjectId(leadId),
      organizationId: new Types.ObjectId(organizationId),
    }).session(this.scope()).exec();
    return row ? this.mapInvitation(row) : null;
  }

  async findActiveByTokenHash(tokenHash: string, now: Date) {
    const row = await this.invitations.findOne({
      tokenHash,
      status: 'ACTIVE',
      expiresAt: { $gt: now },
      revokedAt: { $exists: false },
      consumedAt: { $exists: false },
    }).session(this.scope()).exec();
    return row ? this.mapInvitation(row) : null;
  }

  async claimRegistration(input: {
    tokenHash: string;
    claimId: string;
    now: Date;
    claimExpiresAt: Date;
  }) {
    const session = this.requireTransaction();
    const row = await this.invitations.findOneAndUpdate(
      {
        tokenHash: input.tokenHash,
        status: 'ACTIVE',
        expiresAt: { $gt: input.now },
        revokedAt: { $exists: false },
        consumedAt: { $exists: false },
        registrationUserId: { $exists: false },
        $or: [
          { registrationClaimId: { $exists: false } },
          { registrationClaimExpiresAt: { $lte: input.now } },
        ],
      },
      { $set: { registrationClaimId: input.claimId, registrationClaimExpiresAt: input.claimExpiresAt } },
      { new: true },
    ).session(session).exec();
    return row ? this.mapInvitation(row) : null;
  }

  async completeRegistrationClaim(input: {
    invitationId: string;
    claimId: string;
    userId: string;
    now: Date;
  }): Promise<boolean> {
    const session = this.requireTransaction();
    const result = await this.invitations.updateOne(
      {
        _id: new Types.ObjectId(input.invitationId),
        registrationClaimId: input.claimId,
        status: 'ACTIVE',
        expiresAt: { $gt: input.now },
        revokedAt: { $exists: false },
      },
      {
        $set: { registrationUserId: new Types.ObjectId(input.userId) },
        $unset: { registrationClaimId: 1, registrationClaimExpiresAt: 1 },
      },
    ).session(session).exec();
    return result.modifiedCount === 1;
  }

  async releaseRegistrationClaim(invitationId: string, claimId: string): Promise<boolean> {
    const session = this.requireTransaction();
    const result = await this.invitations.updateOne(
      { _id: new Types.ObjectId(invitationId), registrationClaimId: claimId },
      { $unset: { registrationClaimId: 1, registrationClaimExpiresAt: 1 } },
    ).session(session).exec();
    return result.modifiedCount === 1;
  }

  async rotateToken(input: RotatedContractInvitationInput) {
    const session = this.requireTransaction();
    if (!/^[a-f\d]{24}$/i.test(input.invitationId)) return null;
    const invitationId = new Types.ObjectId(input.invitationId);
    const prior = await this.invitations
      .findOne({ _id: invitationId, leadId: input.leadId })
      .session(session)
      .exec();
    if (!prior || String(prior.organizationId) !== input.organizationId) return null;
    if (prior.lastResendRequestId === input.requestId)
      return { invitation: this.mapInvitation(prior), replayed: true };
    if (prior.status !== 'ACTIVE' || prior.expiresAt.getTime() <= input.now.getTime()) {
      throw new ConflictException({
        code: 'CONTRACT_INVITATION_NOT_RESENDABLE',
        message: 'This invitation is no longer active. Create a new invitation if the contact is still eligible.',
      });
    }
    const cooldownCutoff = new Date(input.now.getTime() - RESEND_COOLDOWN_MS);
    const updated = await this.invitations.findOneAndUpdate(
      {
        _id: invitationId,
        leadId: new Types.ObjectId(input.leadId),
        organizationId: new Types.ObjectId(input.organizationId),
        status: 'ACTIVE',
        expiresAt: { $gt: input.now },
        $and: [
          {
            $or: [
              { lastDeliveryAttemptAt: { $exists: false } },
              { lastDeliveryAttemptAt: { $lte: cooldownCutoff } },
            ],
          },
          {
            $or: [
              { registrationClaimId: { $exists: false } },
              { registrationClaimExpiresAt: { $lte: input.now } },
            ],
          },
        ],
      },
      {
        $set: {
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          deliveryStatus: 'PENDING',
          lastDeliveryAttemptAt: input.now,
          lastResendRequestId: input.requestId,
        },
      },
      { new: true },
    ).session(session).exec();
    if (!updated) {
      throw new HttpException(
        {
          code: 'CONTRACT_INVITATION_RESEND_COOLDOWN',
          message: 'Wait briefly before requesting another invitation email.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return { invitation: this.mapInvitation(updated), replayed: false };
  }

  async updateDelivery(input: {
    invitationId: string;
    tokenHash: string;
    status: ContractInvitationRecord['deliveryStatus'];
    attemptedAt: Date;
  }): Promise<void> {
    const session = this.requireTransaction();
    const result = await this.invitations.updateOne(
      {
        _id: new Types.ObjectId(input.invitationId),
        tokenHash: input.tokenHash,
        status: 'ACTIVE',
      },
      { $set: { deliveryStatus: input.status, lastDeliveryAttemptAt: input.attemptedAt } },
    ).session(session).exec();
    if (result.modifiedCount !== 1) {
      throw new ConflictException({
        code: 'CONTRACT_INVITATION_DELIVERY_STATE_CHANGED',
        message: 'Invitation changed before delivery status could be recorded.',
      });
    }
  }

  async revoke(input: {
    invitationId: string;
    leadId: string;
    organizationId: string;
    now: Date;
  }) {
    const session = this.requireTransaction();
    if (!/^[a-f\d]{24}$/i.test(input.invitationId)) return null;
    const query = {
      _id: new Types.ObjectId(input.invitationId),
      leadId: new Types.ObjectId(input.leadId),
      organizationId: new Types.ObjectId(input.organizationId),
    };
    const current = await this.invitations.findOne(query)
      .select('+registrationClaimId +registrationClaimExpiresAt')
      .session(session)
      .exec();
    if (!current) return null;
    if (current.status === 'REVOKED') return { invitation: this.mapInvitation(current), changed: false };
    if (current.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'CONTRACT_INVITATION_NOT_REVOCABLE',
        message: 'Only an active invitation can be revoked.',
      });
    }
    if (current.registrationClaimId && (current.registrationClaimExpiresAt?.getTime() ?? 0) > input.now.getTime()) {
      throw new ConflictException({
        code: 'CONTRACT_INVITATION_REGISTRATION_IN_PROGRESS',
        message: 'A registration is in progress. Retry revocation shortly.',
      });
    }
    const revoked = await this.invitations.findOneAndUpdate(
      {
        ...query,
        status: 'ACTIVE',
        expiresAt: { $gt: input.now },
        $and: [
          {
            $or: [
              { registrationClaimId: { $exists: false } },
              { registrationClaimExpiresAt: { $lte: input.now } },
            ],
          },
        ],
      },
      { $set: { status: 'REVOKED', revokedAt: input.now }, $unset: { registrationClaimId: 1, registrationClaimExpiresAt: 1 } },
      { new: true },
    ).session(session).exec();
    if (!revoked) {
      const latest = await this.invitations
        .findOne(query)
        .select('+registrationClaimId +registrationClaimExpiresAt')
        .session(session)
        .exec();
      if (latest?.registrationClaimId && (latest.registrationClaimExpiresAt?.getTime() ?? 0) > input.now.getTime()) {
        throw new ConflictException({
          code: 'CONTRACT_INVITATION_REGISTRATION_IN_PROGRESS',
          message: 'A registration is in progress. Retry revocation shortly.',
        });
      }
      throw new ConflictException({ code: 'CONTRACT_INVITATION_CHANGED', message: 'Invitation changed; refresh and retry.' });
    }
    return { invitation: this.mapInvitation(revoked), changed: true };
  }

  async acceptAndGrant(input: AcceptContractInvitationInput): Promise<{
    grant: ContractAccessGrantRecord;
    replayed: boolean;
  } | null> {
    const session = this.requireTransaction();
    const invitation = await this.invitations.findOne({
        tokenHash: input.tokenHash,
        email: input.email,
        $or: [
          { status: 'ACTIVE', expiresAt: { $gt: input.now }, revokedAt: { $exists: false }, consumedAt: { $exists: false } },
          { status: 'CONSUMED', consumedByUserId: new Types.ObjectId(input.userId) },
        ],
    }).session(session).exec();
    if (!invitation) return null;
    if (invitation.registrationUserId && String(invitation.registrationUserId) !== input.userId) return null;

    const userObjectId = new Types.ObjectId(input.userId);
    const existingGrant = await this.grants.findOne({
        userId: userObjectId,
        leadId: invitation.leadId,
    }).session(session).exec();
    if (invitation.status === 'CONSUMED') {
      return existingGrant ? { grant: this.mapGrant(existingGrant), replayed: true } : null;
    }

    const grant = existingGrant ?? (await this.grants.create(
        [{
          userId: userObjectId,
          leadId: invitation.leadId,
          invitationId: invitation._id,
          status: 'ACTIVE',
          phoneVerificationStatus: 'UNVERIFIED',
          signingEligibility: 'BLOCKED_PHONE_UNVERIFIED',
        }],
        { session },
    ))[0];

    const consumed = await this.invitations.updateOne(
        {
          _id: invitation._id,
          tokenHash: input.tokenHash,
          email: input.email,
          status: 'ACTIVE',
          expiresAt: { $gt: input.now },
          revokedAt: { $exists: false },
          consumedAt: { $exists: false },
          ...(invitation.registrationUserId ? { registrationUserId: userObjectId } : {}),
        },
        { $set: { status: 'CONSUMED', consumedAt: input.now, consumedByUserId: userObjectId } },
        { session },
    ).exec();
    if (consumed.modifiedCount !== 1) {
      throw new ConflictException({ code: 'CONTRACT_INVITATION_CHANGED', message: 'Invitation changed; refresh and retry.' });
    }
    return { grant: this.mapGrant(grant), replayed: false };
  }

  async consumePublicRateLimit(input: {
    clientAddress: string;
    action: string;
    now: Date;
    windowMs: number;
  }): Promise<number> {
    const windowStart = Math.floor(input.now.getTime() / input.windowMs);
    const bucketKey = createHash('sha256')
      .update(`${input.action}:${input.clientAddress || 'unknown'}:${windowStart}`)
      .digest('hex');
    const expiresAt = new Date((windowStart + 2) * input.windowMs);
    try {
      const bucket = await this.rateLimits.findOneAndUpdate(
        { bucketKey },
        { $inc: { count: 1 }, $setOnInsert: { bucketKey, expiresAt } },
        { upsert: true, new: true },
      ).exec();
      return bucket?.count ?? 1;
    } catch (error) {
      if (!this.isDuplicateKey(error)) throw error;
      const bucket = await this.rateLimits.findOneAndUpdate(
        { bucketKey },
        { $inc: { count: 1 } },
        { new: true },
      ).exec();
      return bucket?.count ?? 1;
    }
  }

  private mapInvitation(doc: ContractInvitationDocument): ContractInvitationRecord {
    const status = doc.status === 'ACTIVE' && doc.expiresAt.getTime() <= Date.now()
      ? 'EXPIRED'
      : doc.status;
    return {
      id: doc.id,
      leadId: String(doc.leadId),
      organizationId: String(doc.organizationId),
      email: doc.email,
      createdByUserId: String(doc.createdByUserId),
      createRequestId: doc.createRequestId,
      status,
      deliveryStatus: doc.deliveryStatus,
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt,
      ...(doc.revokedAt ? { revokedAt: doc.revokedAt } : {}),
      ...(doc.consumedAt ? { consumedAt: doc.consumedAt } : {}),
      ...(doc.consumedByUserId ? { consumedByUserId: String(doc.consumedByUserId) } : {}),
      ...(doc.registrationUserId ? { registrationUserId: String(doc.registrationUserId) } : {}),
      ...(doc.lastDeliveryAttemptAt ? { lastDeliveryAttemptAt: doc.lastDeliveryAttemptAt } : {}),
      ...(doc.lastResendRequestId ? { lastResendRequestId: doc.lastResendRequestId } : {}),
    };
  }

  private mapGrant(doc: ContractAccessGrantDocument): ContractAccessGrantRecord {
    return {
      id: doc.id,
      leadId: String(doc.leadId),
      userId: String(doc.userId),
      invitationId: String(doc.invitationId),
      status: 'ACTIVE',
      phoneVerificationStatus: 'UNVERIFIED',
      signingEligibility: 'BLOCKED_PHONE_UNVERIFIED',
      createdAt: doc.createdAt,
    };
  }

  private isDuplicateKey(error: unknown): boolean {
    const code = (error as { code?: number | string })?.code;
    return code === 11000 || code === '11000';
  }
}
