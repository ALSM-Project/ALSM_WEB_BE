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
  let sendLeadCreatedNotification: jest.Mock;
  let findById: jest.Mock;
  let claimEmailNotification: jest.Mock;
  let completeEmailNotification: jest.Mock;
  let notificationStatus: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({ lead, replayed: false });
    append = jest.fn().mockResolvedValue(undefined);
    run = jest.fn(async (work: (repositories: SendQuoteRepositories) => Promise<unknown>) =>
      work({
        leads: { create } as unknown as SendQuoteRepositories['leads'],
        audit: { append } as unknown as SendQuoteRepositories['audit'],
      }),
    );
    sendLeadCreatedNotification = jest.fn().mockResolvedValue(true);
    notificationStatus = 'PENDING';
    findById = jest.fn().mockImplementation(async () => ({ ...lead, emailNotificationStatus: notificationStatus }));
    claimEmailNotification = jest.fn().mockImplementation(async () => {
      if (notificationStatus !== 'PENDING' && notificationStatus !== 'FAILED') return null;
      notificationStatus = 'SENDING';
      return { ...lead, emailNotificationStatus: notificationStatus };
    });
    completeEmailNotification = jest.fn().mockImplementation(async (_id, _requestId, delivered: boolean) => {
      notificationStatus = delivered ? 'SENT' : 'FAILED';
      return { ...lead, emailNotificationStatus: notificationStatus };
    });
    service = new CreateLeadService(
      { run } as unknown as SendQuoteUnitOfWork,
      { findById, claimEmailNotification, completeEmailNotification } as never,
      { sendLeadCreatedNotification } as never,
    );
  });

  it('normalizes details, assigns the actor, audits creation, and emails the lead contact after commit', async () => {
    const result = await service.execute(dto, actor, requestId);

    expect(result).toMatchObject({
      lead: { ...lead, emailNotificationStatus: 'SENT' },
      replayed: false,
      notificationSent: true,
      message: 'The contact notification email was sent.',
    });
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
    expect(sendLeadCreatedNotification).toHaveBeenCalledWith({
      to: lead.contactEmail,
      contactName: lead.contactName,
      companyName: lead.companyName,
    });
    await service.notifyContact(lead.id, '35ec340b-f297-4dba-9f2e-25d3dd1af459');
    expect(sendLeadCreatedNotification).toHaveBeenCalledTimes(1);
  });

  it('does not create another audit event or send a duplicate email when the same request is replayed', async () => {
    create.mockResolvedValue({ lead, replayed: true });
    notificationStatus = 'SENT';

    const result = await service.execute(dto, actor, requestId);

    expect(result.replayed).toBe(true);
    expect(result.notificationSent).toBe(true);
    expect(result.message).toMatch(/already sent/i);
    expect(sendLeadCreatedNotification).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('keeps the lead created when SMTP is unavailable and reports the missing notification', async () => {
    sendLeadCreatedNotification.mockResolvedValue(false);

    const result = await service.execute(dto, actor, requestId);

    expect(result.lead.emailNotificationStatus).toBe('FAILED');
    expect(result.notificationSent).toBe(false);
    expect(result.message).toMatch(/contact email could not be sent/i);
  });

  it('does not turn an email transport exception into a failed lead creation', async () => {
    sendLeadCreatedNotification.mockRejectedValue(new Error('SMTP connection details'));

    const result = await service.execute(dto, actor, requestId);

    expect(result.lead.emailNotificationStatus).toBe('FAILED');
    expect(result.notificationSent).toBe(false);
    expect(result.message).toMatch(/contact them manually/i);
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

  it('sends a notification for an existing lead and returns not-found without emailing for an invalid record', async () => {
    const result = await service.notifyContact(lead.id, requestId);
    expect(result.notificationSent).toBe(true);
    expect(sendLeadCreatedNotification).toHaveBeenCalledWith({
      to: lead.contactEmail,
      contactName: lead.contactName,
      companyName: lead.companyName,
    });

    findById.mockResolvedValueOnce(null);
    await expect(service.notifyContact('64b000000000000000000011', requestId)).rejects.toMatchObject({
      status: 404,
    });
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

  it('requires sales.leads.manage on the contact notification endpoint', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LeadController.prototype.notifyContact)).toEqual([
      'sales.leads.manage',
    ]);
  });
});
