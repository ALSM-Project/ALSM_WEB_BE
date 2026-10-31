import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ActivateCrmLeadService } from '../src/modules/crm/application/activate-crm-lead.service';
import { LeadStatus } from '../src/modules/crm/domain/lead.types';

describe('ActivateCrmLeadService (UC-64)', () => {
  const ACTOR_ID = '6a8d90b0569ea93e27ad862c';
  const LEAD_ID = '6ad586fe9f2215c9ebcac858';
  const ORG_ID = '6a9cdbda5e82fb42d449ac03';
  let lead: any;
  let session: any;
  let connection: any;
  let leads: any;
  let organizations: any;
  let users: any;
  let audits: any;
  let crm: any;
  let service: ActivateCrmLeadService;

  const query = (value: unknown) => ({
    session: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });

  beforeEach(() => {
    lead = {
      _id: new Types.ObjectId(LEAD_ID),
      id: LEAD_ID,
      status: LeadStatus.ASSIGNED,
      revision: 4,
      stage: 'PROPOSAL',
      company: 'Zenith Holdings',
      contactName: 'Clara Oswald',
      contactEmail: 'Clara@zenith.co',
      organizationId: new Types.ObjectId('6a9cdbda5e82fb42d449ac03'),
      contracts: [{ id: 'contract-1', plan: 'Enterprise Tier 1', status: 'SIGNED' }],
      save: jest.fn().mockResolvedValue(undefined),
    };
    session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    leads = { findById: jest.fn().mockReturnValue(query(lead)) };
    organizations = {
      findOne: jest.fn().mockReturnValue(query(null)),
      create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(ORG_ID), name: 'Zenith Holdings' }]),
    };
    users = { findOne: jest.fn().mockReturnValue(query(null)) };
    audits = { create: jest.fn().mockResolvedValue([]) };
    crm = { mapLead: jest.fn((doc) => ({ id: doc.id, stage: doc.stage, convertedOrganizationId: doc.convertedOrganizationId?.toString(), provisioning: doc.provisioning })) };
    service = new ActivateCrmLeadService(connection, leads, organizations, users, audits, crm);
  });

  it('rejects invalid actor and lead identifiers before opening a transaction', async () => {
    await expect(service.execute('invalid', LEAD_ID)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.execute(ACTOR_ID, 'invalid')).rejects.toBeInstanceOf(BadRequestException);
    expect(connection.startSession).not.toHaveBeenCalled();
  });

  it('requires a signed contract and leaves all customer records untouched when it is missing', async () => {
    lead.contracts = [{ id: 'contract-1', status: 'SENT_FOR_SIGNATURE' }];

    await expect(service.execute(ACTOR_ID, LEAD_ID)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SIGNED_CONTRACT_REQUIRED' }),
    });

    expect(organizations.create).not.toHaveBeenCalled();
    expect(lead.save).not.toHaveBeenCalled();
    expect(audits.create).not.toHaveBeenCalled();
  });

  it('rejects lost leads without creating an organization', async () => {
    lead.stage = 'LOST';

    await expect(service.execute(ACTOR_ID, LEAD_ID)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LEAD_NOT_CONVERTIBLE' }),
    });
    expect(organizations.create).not.toHaveBeenCalled();
  });

  it('creates one enterprise organization, moves the lead to Won, and audits in the same transaction', async () => {
    const customerUserId = new Types.ObjectId('6b8d90b0569ea93e27ad862c');
    users.findOne.mockReturnValue(query({ _id: customerUserId }));

    const result = await service.execute(ACTOR_ID, LEAD_ID);

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(organizations.create).toHaveBeenCalledWith([expect.objectContaining({
      name: 'Zenith Holdings',
      type: 'ENTERPRISE',
      sourceLeadId: new Types.ObjectId(LEAD_ID),
      contactEmail: 'clara@zenith.co',
      members: [{ userId: customerUserId, role: 'ADMIN' }],
    })], { session });
    expect(lead).toMatchObject({ status: LeadStatus.CONVERTED, stage: 'WON', revision: 5 });
    expect(lead.convertedOrganizationId.toString()).toBe(ORG_ID);
    expect(lead.provisioning).toMatchObject({ status: 'COMPLETED', adminLinked: true, organizationId: ORG_ID });
    expect(lead.save).toHaveBeenCalledWith({ session });
    expect(audits.create).toHaveBeenCalledWith([expect.objectContaining({
      action: 'LEAD_CONVERTED_TO_CUSTOMER',
      resourceId: LEAD_ID,
    })], { session });
    expect(result).toMatchObject({ organizationId: ORG_ID, adminLinked: true, replayed: false, lead: { stage: 'WON' } });
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('does not invent an account when no active ALSM user matches the customer email', async () => {
    const result = await service.execute(ACTOR_ID, LEAD_ID);

    expect(organizations.create).toHaveBeenCalledWith([expect.objectContaining({ members: [] })], { session });
    expect(result.adminLinked).toBe(false);
    expect(lead.provisioning.adminLinked).toBe(false);
  });

  it('returns the persisted conversion on retry without creating another organization or audit', async () => {
    lead.stage = 'WON';
    lead.status = LeadStatus.CONVERTED;
    lead.convertedOrganizationId = new Types.ObjectId(ORG_ID);
    lead.provisioning = { status: 'COMPLETED', organizationId: ORG_ID, adminLinked: false };

    const result = await service.execute(ACTOR_ID, LEAD_ID);

    expect(result.replayed).toBe(true);
    expect(organizations.create).not.toHaveBeenCalled();
    expect(audits.create).not.toHaveBeenCalled();
  });

  it('returns a safe processing error when audit persistence fails so Mongo can abort the transaction', async () => {
    audits.create.mockRejectedValue(new Error('private database connection detail'));

    await expect(service.execute(ACTOR_ID, LEAD_ID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('reports an unreconciled legacy Won lead as a conflict', async () => {
    lead.stage = 'WON';

    await expect(service.execute(ACTOR_ID, LEAD_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(organizations.create).not.toHaveBeenCalled();
  });
});
