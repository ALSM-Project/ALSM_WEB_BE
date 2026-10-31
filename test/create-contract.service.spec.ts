import { BadRequestException } from '@nestjs/common';
import { AuthenticatedUser } from '../src/shared/logging/request-id.middleware';
import { AddLeadContractInput, LeadRecord } from '../src/modules/crm/domain/lead.types';
import { SalesMutationRepositories, SalesUnitOfWork } from '../src/modules/crm/application/sales-unit-of-work.port';
import { CreateContractService } from '../src/modules/crm/application/create-contract.service';

describe('CreateContractService (UC-63)', () => {
  const LEAD_ID = '6ad586fe9f2215c9ebcac858';
  const ACTOR_ID = '6a8d90b0569ea93e27ad862c';
  const REQUEST_ID = '8c5f0e16-58f3-49b6-941d-f1cb39c53afd';
  const actor: AuthenticatedUser = { userId: ACTOR_ID, email: 'sales@alsm.dev', isPlatformAdmin: false };
  const input = {
    title: 'Modernization services agreement',
    plan: 'Enterprise Tier 1',
    annualValue: 135000,
    effectiveDate: '2026-11-01',
  };
  let leads: { addContract: jest.Mock };
  let audit: { append: jest.Mock };
  let unitOfWork: jest.Mocked<SalesUnitOfWork>;
  let service: CreateContractService;

  const lead = { id: LEAD_ID, organizationId: '6a9cdbda5e82fb42d449ac03' } as LeadRecord;
  const setupCreatedContract = () => {
    leads.addContract.mockImplementation(async (operation: AddLeadContractInput) => ({
      lead,
      replayed: false,
      contract: {
        ...operation.contract,
        requestId: operation.requestId,
        requestFingerprint: operation.requestFingerprint,
        contractNumber: 'CTR-2026-MODX-0001',
      },
    }));
  };

  beforeEach(() => {
    leads = { addContract: jest.fn() };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    unitOfWork = { run: jest.fn() } as unknown as jest.Mocked<SalesUnitOfWork>;
    unitOfWork.run.mockImplementation(async <T>(work: (repos: SalesMutationRepositories) => Promise<T>) =>
      work({ leads, revenue: {} as never, audit } as unknown as SalesMutationRepositories),
    );
    service = new CreateContractService(unitOfWork);
  });

  it('rejects invalid identifiers, missing request keys, and invalid contract fields before opening a transaction', async () => {
    await expect(service.execute('bad-id', input, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, input, actor, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, { ...input, annualValue: 0 }, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, { ...input, effectiveDate: '2026-02-30' }, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });

  it('creates a DRAFT, audits it in the same unit of work, and strips idempotency metadata from the response', async () => {
    setupCreatedContract();

    const result = await service.execute(LEAD_ID, input, actor, REQUEST_ID);

    expect(result).toMatchObject({
      replayed: false,
      message: 'Contract draft created successfully.',
      contract: {
        contractNumber: 'CTR-2026-MODX-0001',
        title: input.title,
        plan: input.plan,
        annualValue: input.annualValue,
        status: 'DRAFT',
      },
    });
    expect(result.contract).not.toHaveProperty('requestId');
    expect(result.contract).not.toHaveProperty('requestFingerprint');
    expect(leads.addContract).toHaveBeenCalledWith(expect.objectContaining({
      leadId: LEAD_ID,
      requestId: REQUEST_ID,
      contract: expect.objectContaining({ ...input, status: 'DRAFT', createdByUserId: ACTOR_ID }),
    }));
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LEAD_CONTRACT_CREATED',
      resourceId: LEAD_ID,
      metadata: expect.objectContaining({ contractNumber: 'CTR-2026-MODX-0001', status: 'DRAFT' }),
    }));
  });

  it('returns an idempotent replay without writing a second audit event', async () => {
    leads.addContract.mockImplementation(async (operation: AddLeadContractInput) => ({
      lead,
      replayed: true,
      contract: {
        ...operation.contract,
        requestId: operation.requestId,
        requestFingerprint: operation.requestFingerprint,
        contractNumber: 'CTR-2026-MODX-0001',
      },
    }));

    const result = await service.execute(LEAD_ID, input, actor, REQUEST_ID);

    expect(result.replayed).toBe(true);
    expect(result.message).toContain('no duplicate contract');
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('propagates audit failure so the unit of work can roll back the contract write', async () => {
    setupCreatedContract();
    audit.append.mockRejectedValue(new Error('audit storage unavailable'));

    await expect(service.execute(LEAD_ID, input, actor, REQUEST_ID)).rejects.toThrow('audit storage unavailable');
    expect(leads.addContract).toHaveBeenCalledTimes(1);
  });
});
