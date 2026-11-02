import { ClientSession, Connection, Model, Types } from 'mongoose';
import { LeadContractRecord } from '../src/modules/crm/domain/lead.types';
import { Lead } from '../src/modules/crm/infrastructure/lead.schema';
import { MongoLeadRepository } from '../src/modules/crm/infrastructure/mongo-lead.repository';

describe('MongoLeadRepository.addContract', () => {
  const leadId = new Types.ObjectId().toHexString();
  const organizationId = new Types.ObjectId().toHexString();
  const requestId = '8c5f0e16-58f3-49b6-941d-f1cb39c53afd';
  const requestFingerprint = 'a'.repeat(64);
  const transaction = {};
  const session = {
    hasEnded: false,
    explicit: true,
    transaction,
    inTransaction: () => true,
  } as unknown as ClientSession;
  const connection = {} as Connection;
  const contract = (): Omit<LeadContractRecord, 'requestId' | 'requestFingerprint' | 'contractNumber'> => ({
    id: 'contract-id',
    title: 'Modernization services agreement',
    plan: 'Enterprise Tier 1',
    annualValue: 135000,
    status: 'DRAFT',
    effectiveDate: '2026-11-01',
    createdByUserId: new Types.ObjectId().toHexString(),
    createdAt: new Date('2026-10-31T08:00:00.000Z'),
  });
  const query = <T,>(value: T) => ({
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });

  it('creates a contract without mapping unrelated legacy assignment data', async () => {
    // Older CRM leads can lack sales assignment history. Contract creation only
    // needs the lead organization and must not fail while building an unused view model.
    const legacyLead = {
      _id: new Types.ObjectId(leadId),
      organizationId: new Types.ObjectId(organizationId),
      stage: 'NEW',
      company: 'fpt software',
      contracts: [],
    };
    const updatedLead = { ...legacyLead };
    const model = {
      db: connection,
      findById: jest.fn().mockReturnValue(query(legacyLead)),
      findOneAndUpdate: jest.fn().mockReturnValue(query(updatedLead)),
    } as unknown as Model<Lead>;
    const repository = new MongoLeadRepository(model).inTransaction(session, connection);

    const result = await repository.addContract({
      leadId,
      requestId,
      requestFingerprint,
      contract: contract(),
    });

    expect(result).toMatchObject({
      organizationId,
      replayed: false,
      contract: {
        title: 'Modernization services agreement',
        contractNumber: 'CTR-2026-FPTS-0001',
        status: 'DRAFT',
      },
    });
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('returns an idempotent retry without mapping assignment history', async () => {
    const existing = {
      ...contract(),
      requestId,
      requestFingerprint,
      contractNumber: 'CTR-2026-FPTS-0001',
    } as LeadContractRecord;
    const legacyLead = {
      _id: new Types.ObjectId(leadId),
      organizationId: new Types.ObjectId(organizationId),
      stage: 'NEW',
      contracts: [existing],
    };
    const model = {
      db: connection,
      findById: jest.fn().mockReturnValue(query(legacyLead)),
      findOneAndUpdate: jest.fn(),
    } as unknown as Model<Lead>;
    const repository = new MongoLeadRepository(model).inTransaction(session, connection);

    const result = await repository.addContract({
      leadId,
      requestId,
      requestFingerprint,
      contract: contract(),
    });

    expect(result).toMatchObject({ organizationId, replayed: true, contract: existing });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
