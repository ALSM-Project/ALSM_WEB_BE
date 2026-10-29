import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLeadService } from '../src/modules/leads/application/create-lead.service';
import {
  SendQuoteRepositories,
  SendQuoteUnitOfWork,
} from '../src/modules/leads/application/send-quote-unit-of-work.port';
import { LeadPriority, LeadSource, LeadStatus } from '../src/modules/leads/domain/lead.types';
import { LeadController } from '../src/modules/leads/presentation/lead.controller';
import { CreateLeadDto } from '../src/modules/leads/presentation/lead.dto';
import {
  LeadSchema as SalesLeadSchema,
  UC58_LEAD_MODEL,
} from '../src/modules/leads/infrastructure/lead.schema';
import { PERMISSIONS_KEY } from '../src/shared/security/require-permissions.decorator';

const actor = {
  userId: '64b000000000000000000001',
  email: 'sales@example.test',
  isPlatformAdmin: false,
};

const requestId = 'f9d7e850-5b1c-4b80-9a2c-d39209f87e33';

const dto: CreateLeadDto = {
  companyName: '  Example Bank  ',
  contactName: '  Alex Smith  ',
  contactEmail: '  ALEX@EXAMPLE.TEST  ',
  contactPhone: '+1 555 123 4567',
  jobTitle: 'CTO',
  source: LeadSource.REFERRAL,
  priority: LeadPriority.HIGH,
  estimatedValue: 125000,
  currency: 'USD',
  notes: 'Interested in modernization',
};

describe('CreateLeadService (UC-59)', () => {
  const lead = {
    id: '64b000000000000000000010',
    companyName: 'Example Bank',
    contactName: 'Alex Smith',
    contactEmail: 'alex@example.test',
    contactPhone: '+1 555 123 4567',
    jobTitle: 'CTO',
    status: LeadStatus.NEW,
    source: LeadSource.REFERRAL,
    priority: LeadPriority.HIGH,
    estimatedValue: 125000,
    currency: 'USD',
    notes: 'Interested in modernization',
    assignedToUserId: actor.userId,
    assignedToEmail: actor.email,
    tags: [],
    createdByUserId: actor.userId,
    createdByEmail: actor.email,
    createdAt: new Date('2026-10-29T00:00:00.000Z'),
    updatedAt: new Date('2026-10-29T00:00:00.000Z'),
  };

  let create: jest.Mock;
  let append: jest.Mock;
  let run: jest.Mock;
  let service: CreateLeadService;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({ lead, replayed: false });
    append = jest.fn().mockResolvedValue(undefined);
    run = jest.fn(async (work: (repositories: SendQuoteRepositories) => Promise<unknown>) =>
      work({
        leads: { create } as unknown as SendQuoteRepositories['leads'],
        audit: { append } as unknown as SendQuoteRepositories['audit'],
      }),
    );
    service = new CreateLeadService({ run } as unknown as SendQuoteUnitOfWork);
  });

  it('normalizes details, assigns the actor, commits one audit event, and returns the created lead', async () => {
    const result = await service.execute(dto, actor, requestId);

    expect(result).toEqual({ lead, replayed: false, message: 'Lead created successfully.' });
    expect(run).toHaveBeenCalledWith(expect.any(Function), expect.stringMatching(/^[a-f\d]{24}$/));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      companyName: 'Example Bank',
      contactName: 'Alex Smith',
      contactEmail: 'alex@example.test',
      source: LeadSource.REFERRAL,
      priority: LeadPriority.HIGH,
      estimatedValue: 125000,
      assignedToUserId: actor.userId,
      assignedToEmail: actor.email,
      createdByUserId: actor.userId,
      createdByEmail: actor.email,
      creationFingerprint: expect.stringMatching(/^[a-f\d]{64}$/),
      dedupeKey: expect.stringMatching(/^[a-f\d]{64}$/),
    }));
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: actor.userId,
      action: 'LEAD_CREATED',
      resourceType: 'LEAD',
      resourceId: lead.id,
    }));
  });

  it('does not create another audit event when the same request is replayed', async () => {
    create.mockResolvedValue({ lead, replayed: true });

    const result = await service.execute(dto, actor, requestId);

    expect(result.replayed).toBe(true);
    expect(append).not.toHaveBeenCalled();
  });

  it('rejects missing idempotency keys before any write', async () => {
    await expect(service.execute(dto, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });

  it('preserves duplicate-email conflicts from the repository', async () => {
    create.mockRejectedValue(new ConflictException({ code: 'LEAD_EMAIL_EXISTS', message: 'Duplicate' }));

    await expect(service.execute(dto, actor, requestId)).rejects.toBeInstanceOf(ConflictException);
    expect(append).not.toHaveBeenCalled();
  });

  it('returns a safe dependency error without leaking transaction metadata', async () => {
    run.mockRejectedValue(new ServiceUnavailableException({
      code: 'ATOMIC_MUTATION_ABORTED',
      message: 'Internal transaction failure',
      details: [{ resourceId: 'internal-id', mutationCommitted: false }],
    }));

    try {
      await service.execute(dto, actor, requestId);
      throw new Error('Expected service to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        code: 'LEAD_CREATION_UNAVAILABLE',
        message: 'Lead creation is temporarily unavailable. Retry the same request shortly.',
      });
    }
  });
});

describe('CreateLeadDto and UC-59 authorization', () => {
  it('uses a dedicated Mongoose model name with the sales lead fields', () => {
    expect(UC58_LEAD_MODEL).not.toBe('Lead');
    expect(SalesLeadSchema.get('collection')).toBe('leads');
    expect(SalesLeadSchema.path('companyName')).toBeDefined();
    expect(SalesLeadSchema.path('contactEmail')).toBeDefined();
    expect(SalesLeadSchema.path('title')).toBeUndefined();
  });

  it('accepts valid form values and rejects malformed email, negative value, and extra assignment fields', async () => {
    const valid = plainToInstance(CreateLeadDto, {
      companyName: ' Example Bank ',
      contactName: ' Alex Smith ',
      contactEmail: 'ALEX@EXAMPLE.TEST',
      source: 'WEBSITE',
      priority: 'MEDIUM',
      estimatedValue: '200.50',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.contactEmail).toBe('alex@example.test');
    expect(valid.estimatedValue).toBe(200.5);

    const invalid = plainToInstance(CreateLeadDto, {
      companyName: 'Example Bank',
      contactName: 'Alex Smith',
      contactEmail: 'not-an-email',
      source: 'UNKNOWN',
      estimatedValue: '-1',
      assignedToUserId: actor.userId,
    });
    const errors = await validate(invalid, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      'contactEmail',
      'source',
      'estimatedValue',
      'assignedToUserId',
    ]));
  });

  it('requires sales.leads.manage on the create endpoint', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LeadController.prototype.create)).toEqual([
      'sales.leads.manage',
    ]);
  });
});
