import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BillingService } from '../src/modules/billing/application/billing.service';
import { getConnectionToken } from '@nestjs/mongoose';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationRole } from '../src/modules/organizations/domain/organization.types';
import { BillingController } from '../src/modules/billing/presentation/billing.controller';
import { UsageService } from '../src/modules/billing/application/usage.service';
import {
  INVOICE_REPOSITORY,
  PLAN_REPOSITORY,
  QUOTE_REQUEST_REPOSITORY,
  SUBSCRIPTION_REPOSITORY,
} from '../src/modules/billing/domain/billing.repository.interface';
import { PlanTier, QuoteRequestStatus } from '../src/modules/billing/domain/billing.types';
import { RequestEnterpriseQuoteDto } from '../src/modules/billing/presentation/billing.dto';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../src/shared/logging/request-id.middleware';

describe('UC-32: Enterprise Quote Request', () => {
  let service: BillingService;
  let controller: BillingController;
  let quoteRequestRepo: {
    findPendingByUser: jest.Mock;
    findLatestByUser: jest.Mock;
    findAll: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    updateStatus: jest.Mock;
  };
  let subscriptionRepo: {
    findActiveByUser: jest.Mock;
    findLatestByUser: jest.Mock;
    updatePlan: jest.Mock;
    updateStatus: jest.Mock;
    create: jest.Mock;
  };
  let invoiceRepo: {
    findRecentByUser: jest.Mock;
    countDocuments: jest.Mock;
  };
  let planRepo: {
    findAllActive: jest.Mock;
    findByTier: jest.Mock;
    seedDefaults: jest.Mock;
  };
  let usageService: {
    getUsageStats: jest.Mock;
  };
  const validQuoteId = '507f1f77bcf86cd799439011';
  const mockSession = {
    withTransaction: jest.fn(async (callback: () => Promise<void>) => callback()),
    endSession: jest.fn(),
  };
  const mockConnection = { startSession: jest.fn().mockResolvedValue(mockSession) };
  const organizationContext = {
    resolve: jest.fn().mockResolvedValue({
      id: 'org-123',
      members: [{ userId: 'user-123', role: OrganizationRole.OWNER }],
    }),
  };

  const mockUser: AuthenticatedUser = {
    userId: 'user-123',
    email: 'admin@acme.corp',
    isPlatformAdmin: false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    quoteRequestRepo = {
      findPendingByUser: jest.fn(),
      findLatestByUser: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
    };
    subscriptionRepo = {
      findActiveByUser: jest.fn().mockResolvedValue({
        id: 'sub-1',
        planTier: PlanTier.PROFESSIONAL,
      }),
      findLatestByUser: jest.fn().mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-123',
        planTier: PlanTier.PROFESSIONAL,
        status: 'ACTIVE',
      }),
      updatePlan: jest.fn().mockResolvedValue({ id: 'sub-1', planTier: PlanTier.ENTERPRISE, status: 'ACTIVE' }),
      updateStatus: jest.fn().mockResolvedValue({ id: 'sub-1', planTier: PlanTier.ENTERPRISE, status: 'ACTIVE' }),
      create: jest.fn().mockResolvedValue({ id: 'sub-enterprise', planTier: PlanTier.ENTERPRISE, status: 'ACTIVE' }),
    };
    invoiceRepo = {
      findRecentByUser: jest.fn(),
      countDocuments: jest.fn(),
    };
    planRepo = {
      findAllActive: jest.fn().mockResolvedValue([]),
      findByTier: jest.fn(),
      seedDefaults: jest.fn(),
    };
    usageService = {
      getUsageStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        BillingService,
        { provide: getConnectionToken(), useValue: mockConnection },
        { provide: OrganizationContextService, useValue: organizationContext },
        { provide: UsageService, useValue: usageService },
        { provide: QUOTE_REQUEST_REPOSITORY, useValue: quoteRequestRepo },
        { provide: SUBSCRIPTION_REPOSITORY, useValue: subscriptionRepo },
        { provide: INVOICE_REPOSITORY, useValue: invoiceRepo },
        { provide: PLAN_REPOSITORY, useValue: planRepo },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    service = module.get<BillingService>(BillingService);
    controller = module.get<BillingController>(BillingController);
  });

  describe('Validation: RequestEnterpriseQuoteDto', () => {
    it('should validate a valid enterprise quote request DTO', async () => {
      const dto = plainToInstance(RequestEnterpriseQuoteDto, {
        fullName: 'Jane Doe',
        companyName: 'ACME Enterprise',
        email: 'jane@acme.com',
        phone: '+84901234567',
        message: 'Need 500 BMS screen migration',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when email is invalid', async () => {
      const dto = plainToInstance(RequestEnterpriseQuoteDto, {
        fullName: 'Jane Doe',
        companyName: 'ACME Enterprise',
        email: 'not-an-email',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
    });

    it('should fail validation when required fields are missing', async () => {
      const dto = plainToInstance(RequestEnterpriseQuoteDto, {
        email: 'jane@acme.com',
      });

      const errors = await validate(dto);
      const properties = errors.map((e) => e.property);
      expect(properties).toContain('fullName');
      expect(properties).toContain('companyName');
    });

    it('should fail validation when phone format is invalid', async () => {
      const dto = plainToInstance(RequestEnterpriseQuoteDto, {
        fullName: 'Jane Doe',
        companyName: 'ACME Enterprise',
        email: 'jane@acme.com',
        phone: 'invalid-phone-123',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'phone')).toBe(true);
    });

    it('should pass validation when optional phone is omitted', async () => {
      const dto = plainToInstance(RequestEnterpriseQuoteDto, {
        fullName: 'Jane Doe',
        companyName: 'ACME Enterprise',
        email: 'jane@acme.com',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('BillingService.requestEnterpriseQuote', () => {
    it('should successfully create an enterprise quote request when no pending request exists', async () => {
      quoteRequestRepo.findPendingByUser.mockResolvedValue(null);
      quoteRequestRepo.create.mockResolvedValue({
        id: 'quote-req-1',
        userId: 'user-123',
        organizationId: 'org-123',
        fullName: 'Jane Doe',
        companyName: 'ACME Enterprise',
        email: 'jane@acme.com',
        phone: '+84901234567',
        message: 'Scope for migration',
        currentPlanTier: PlanTier.PROFESSIONAL,
        status: QuoteRequestStatus.PENDING,
        createdAt: new Date('2026-09-25T10:00:00Z'),
      });

      const result = await service.requestEnterpriseQuote(mockUser, {
        fullName: 'Jane Doe',
        companyName: 'ACME Enterprise',
        email: 'jane@acme.com',
        phone: '+84901234567',
        message: 'Scope for migration',
      });

      expect(quoteRequestRepo.findPendingByUser).toHaveBeenCalledWith('user-123');
      expect(quoteRequestRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          organizationId: 'org-123',
          fullName: 'Jane Doe',
          companyName: 'ACME Enterprise',
          email: 'jane@acme.com',
          currentPlanTier: PlanTier.PROFESSIONAL,
          status: QuoteRequestStatus.PENDING,
        }),
      );
      expect(result.id).toBe('quote-req-1');
      expect(result.status).toBe(QuoteRequestStatus.PENDING);
    });

    it('should throw ConflictException if a pending request already exists', async () => {
      quoteRequestRepo.findPendingByUser.mockResolvedValue({
        id: 'existing-req',
        userId: 'user-123',
        status: QuoteRequestStatus.PENDING,
      });

      await expect(
        service.requestEnterpriseQuote(mockUser, {
          fullName: 'Jane Doe',
          companyName: 'ACME Enterprise',
          email: 'jane@acme.com',
        }),
      ).rejects.toThrow(ConflictException);

      expect(quoteRequestRepo.create).not.toHaveBeenCalled();
    });

    it('trims submitted values and accepts a request at the 1000 character message limit', async () => {
      quoteRequestRepo.findPendingByUser.mockResolvedValue(null);
      quoteRequestRepo.create.mockImplementation(async (request) => ({ id: 'quote-trimmed', ...request }));

      await service.requestEnterpriseQuote(mockUser, {
        fullName: '  Jane Doe  ',
        companyName: '  ACME Enterprise  ',
        email: ' jane@acme.com ',
        phone: '  +84901234567  ',
        message: ` ${'x'.repeat(1000)} `,
      });

      expect(quoteRequestRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        fullName: 'Jane Doe',
        companyName: 'ACME Enterprise',
        email: 'jane@acme.com',
        phone: '+84901234567',
        message: 'x'.repeat(1000),
      }));
    });

    it.each([
      ['one-character name', { fullName: 'J', companyName: 'ACME', email: 'jane@acme.com' }],
      ['blank name', { fullName: '  ', companyName: 'ACME', email: 'jane@acme.com' }],
      ['blank company', { fullName: 'Jane Doe', companyName: '  ', email: 'jane@acme.com' }],
      ['blank email', { fullName: 'Jane Doe', companyName: 'ACME', email: '  ' }],
      ['message over limit', { fullName: 'Jane Doe', companyName: 'ACME', email: 'jane@acme.com', message: 'x'.repeat(1001) }],
    ])('rejects invalid %s before creating a request', async (_label, dto) => {
      await expect(service.requestEnterpriseQuote(mockUser, dto)).rejects.toThrow(BadRequestException);
      expect(quoteRequestRepo.findPendingByUser).not.toHaveBeenCalled();
      expect(quoteRequestRepo.create).not.toHaveBeenCalled();
    });

    it('allows an organization admin to submit the request', async () => {
      organizationContext.resolve.mockResolvedValueOnce({
        id: 'org-123',
        members: [{ userId: 'user-123', role: OrganizationRole.ADMIN }],
      });
      quoteRequestRepo.findPendingByUser.mockResolvedValue(null);
      quoteRequestRepo.create.mockImplementation(async (request) => ({ id: 'quote-admin', ...request }));

      const result = await service.requestEnterpriseQuote(mockUser, {
        fullName: 'Jane Doe', companyName: 'ACME', email: 'jane@acme.com',
      });

      expect(result.id).toBe('quote-admin');
      expect(quoteRequestRepo.create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-123' }));
    });

    it.each([OrganizationRole.MEMBER, OrganizationRole.VIEWER])(
      'denies organization role %s from requesting a migration quote', async (role) => {
        organizationContext.resolve.mockResolvedValueOnce({
          id: 'org-123',
          members: [{ userId: 'user-123', role }],
        });
        quoteRequestRepo.findPendingByUser.mockResolvedValue(null);

        await expect(service.requestEnterpriseQuote(mockUser, {
          fullName: 'Jane Doe', companyName: 'ACME', email: 'jane@acme.com',
        })).rejects.toThrow(ForbiddenException);
        expect(quoteRequestRepo.create).not.toHaveBeenCalled();
      },
    );

    it('rejects an account that already has an active Enterprise subscription', async () => {
      quoteRequestRepo.findPendingByUser.mockResolvedValue(null);
      subscriptionRepo.findLatestByUser.mockResolvedValue({
        id: 'sub-enterprise', planTier: PlanTier.ENTERPRISE, status: 'ACTIVE',
      });

      await expect(service.requestEnterpriseQuote(mockUser, {
        fullName: 'Jane Doe', companyName: 'ACME', email: 'jane@acme.com',
      })).rejects.toThrow(ConflictException);
      expect(organizationContext.resolve).not.toHaveBeenCalled();
      expect(quoteRequestRepo.create).not.toHaveBeenCalled();
    });

    it('maps a duplicate-key race to a duplicate request conflict', async () => {
      quoteRequestRepo.findPendingByUser.mockResolvedValue(null);
      quoteRequestRepo.create.mockRejectedValue({ code: 11000 });

      await expect(service.requestEnterpriseQuote(mockUser, {
        fullName: 'Jane Doe', companyName: 'ACME', email: 'jane@acme.com',
      })).rejects.toThrow(ConflictException);
    });

    it('surfaces request repository failures without persisting a false success', async () => {
      quoteRequestRepo.findPendingByUser.mockResolvedValue(null);
      quoteRequestRepo.create.mockRejectedValue(new Error('database unavailable'));

      await expect(service.requestEnterpriseQuote(mockUser, {
        fullName: 'Jane Doe', companyName: 'ACME', email: 'jane@acme.com',
      })).rejects.toThrow('database unavailable');
    });
  });

  describe('BillingController.requestEnterpriseQuote', () => {
    it('should handle controller request and return formatted presenter response', async () => {
      quoteRequestRepo.findPendingByUser.mockResolvedValue(null);
      quoteRequestRepo.create.mockResolvedValue({
        id: 'quote-req-2',
        userId: 'user-123',
        organizationId: 'org-123',
        fullName: 'John Smith',
        companyName: 'Legacy Bank',
        email: 'john@legacybank.com',
        currentPlanTier: PlanTier.STARTER,
        status: QuoteRequestStatus.PENDING,
        createdAt: new Date('2026-09-25T10:00:00Z'),
      });

      const dto: RequestEnterpriseQuoteDto = {
        fullName: 'John Smith',
        companyName: 'Legacy Bank',
        email: 'john@legacybank.com',
      };

      const response = await controller.requestEnterpriseQuote(mockUser, dto);

      expect(response).toEqual(
        expect.objectContaining({
          id: 'quote-req-2',
          fullName: 'John Smith',
          companyName: 'Legacy Bank',
          email: 'john@legacybank.com',
          status: QuoteRequestStatus.PENDING,
        }),
      );
    });
  });

  describe('BillingService.getMyQuoteRequest', () => {
    it('should return null when user has no quote request', async () => {
      quoteRequestRepo.findLatestByUser = jest.fn().mockResolvedValue(null);

      const result = await service.getMyQuoteRequest('user-123');

      expect(quoteRequestRepo.findLatestByUser).toHaveBeenCalledWith('user-123');
      expect(result).toBeNull();
    });

    it('should return the latest quote request for the user', async () => {
      const mockRequest = {
        id: 'quote-req-latest',
        userId: 'user-123',
        organizationId: 'org-123',
        fullName: 'Jane Doe',
        companyName: 'ACME Enterprise',
        email: 'jane@acme.com',
        currentPlanTier: PlanTier.PROFESSIONAL,
        status: QuoteRequestStatus.CONTACTED,
        createdAt: new Date('2026-09-25T10:00:00Z'),
      };
      quoteRequestRepo.findLatestByUser = jest.fn().mockResolvedValue(mockRequest);

      const result = await service.getMyQuoteRequest('user-123');

      expect(result?.id).toBe('quote-req-latest');
      expect(result?.status).toBe(QuoteRequestStatus.CONTACTED);
    });
  });

  describe('BillingController.getMyQuoteRequest', () => {
    it('should return null when user has no quote request', async () => {
      quoteRequestRepo.findLatestByUser = jest.fn().mockResolvedValue(null);

      const result = await controller.getMyQuoteRequest(mockUser);
      expect(result).toBeNull();
    });

    it('should return formatted quote request for authenticated user', async () => {
      quoteRequestRepo.findLatestByUser = jest.fn().mockResolvedValue({
        id: 'quote-req-3',
        userId: 'user-123',
        organizationId: 'org-123',
        fullName: 'Jane Doe',
        companyName: 'ACME Enterprise',
        email: 'jane@acme.com',
        currentPlanTier: PlanTier.PROFESSIONAL,
        status: QuoteRequestStatus.PENDING,
        createdAt: new Date('2026-09-25T10:00:00Z'),
      });

      const result = await controller.getMyQuoteRequest(mockUser);

      expect(result).toEqual(
        expect.objectContaining({
          id: 'quote-req-3',
          email: 'jane@acme.com',
          status: QuoteRequestStatus.PENDING,
        }),
      );
    });
  });

  describe('Admin: listQuoteRequests', () => {
    const adminUser: AuthenticatedUser = {
      userId: 'admin-1',
      email: 'admin@alsm.io',
      isPlatformAdmin: true,
    };

    it('should throw ForbiddenException if user is not platform admin', async () => {
      await expect(service.listQuoteRequests(mockUser)).rejects.toThrow(ForbiddenException);
    });

    it('should return list of quote requests and total for platform admin', async () => {
      const mockItems = [
        {
          id: 'quote-1',
          userId: 'user-1',
          organizationId: 'org-1',
          fullName: 'User One',
          companyName: 'Company 1',
          email: 'user1@test.com',
          currentPlanTier: PlanTier.STARTER,
          status: QuoteRequestStatus.PENDING,
        },
      ];
      quoteRequestRepo.findAll.mockResolvedValue({ items: mockItems, total: 1 });

      const result = await service.listQuoteRequests(adminUser, {
        status: QuoteRequestStatus.PENDING,
        page: 1,
        limit: 10,
      });

      expect(quoteRequestRepo.findAll).toHaveBeenCalledWith(
        { status: QuoteRequestStatus.PENDING, page: 1, limit: 10 },
        1,
        10,
      );
      expect(result.items.length).toBe(1);
      expect(result.total).toBe(1);
    });

    it.each([
      [{ page: 0 }, 'page'],
      [{ page: 1.5 }, 'page'],
      [{ limit: 0 }, 'limit'],
      [{ limit: 101 }, 'limit'],
      [{ limit: 1.5 }, 'limit'],
    ])('rejects invalid pagination %s', async (filters, _field) => {
      await expect(service.listQuoteRequests(adminUser, filters)).rejects.toThrow(BadRequestException);
      expect(quoteRequestRepo.findAll).not.toHaveBeenCalled();
    });

    it('accepts the maximum page size of 100', async () => {
      quoteRequestRepo.findAll.mockResolvedValue({ items: [], total: 0 });
      await service.listQuoteRequests(adminUser, { page: 1, limit: 100 });
      expect(quoteRequestRepo.findAll).toHaveBeenCalledWith({ page: 1, limit: 100 }, 1, 100);
    });
  });

  describe('Admin: updateQuoteRequestStatus', () => {
    const adminUser: AuthenticatedUser = {
      userId: 'admin-1',
      email: 'admin@alsm.io',
      isPlatformAdmin: true,
    };

    it('should throw ForbiddenException if user is not platform admin', async () => {
      await expect(
        service.updateQuoteRequestStatus(mockUser, validQuoteId, QuoteRequestStatus.CONTACTED),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if quote request does not exist', async () => {
      quoteRequestRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateQuoteRequestStatus(adminUser, validQuoteId, QuoteRequestStatus.CONTACTED),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update status from PENDING to CONTACTED for admin', async () => {
      quoteRequestRepo.findById.mockResolvedValue({
        id: validQuoteId,
        status: QuoteRequestStatus.PENDING,
      });
      quoteRequestRepo.updateStatus.mockResolvedValue({
        id: validQuoteId,
        status: QuoteRequestStatus.CONTACTED,
      });

      const result = await service.updateQuoteRequestStatus(adminUser, validQuoteId, QuoteRequestStatus.CONTACTED);

      expect(quoteRequestRepo.updateStatus).toHaveBeenCalledWith(
        validQuoteId,
        QuoteRequestStatus.CONTACTED,
        undefined,
        mockSession,
        QuoteRequestStatus.PENDING,
      );
      expect(result.status).toBe(QuoteRequestStatus.CONTACTED);
    });

    it('approves a pending request and upgrades the existing subscription inside a transaction', async () => {
      subscriptionRepo.findActiveByUser.mockResolvedValueOnce({
        id: 'sub-1', userId: 'user-123', organizationId: 'org-123', planTier: PlanTier.PROFESSIONAL,
      });
      quoteRequestRepo.findById.mockResolvedValue({
        id: validQuoteId,
        userId: 'user-123',
        organizationId: 'org-123',
        status: QuoteRequestStatus.PENDING,
      });
      quoteRequestRepo.updateStatus.mockResolvedValue({ id: validQuoteId, status: QuoteRequestStatus.APPROVED });

      const result = await service.updateQuoteRequestStatus(adminUser, validQuoteId, QuoteRequestStatus.APPROVED);

      expect(subscriptionRepo.updatePlan).toHaveBeenCalledWith('sub-1', expect.objectContaining({
        planTier: PlanTier.ENTERPRISE,
        status: 'ACTIVE',
        amountVnd: 0,
      }), mockSession);
      expect(quoteRequestRepo.updateStatus).toHaveBeenCalledWith(
        validQuoteId, QuoteRequestStatus.APPROVED, undefined, mockSession, QuoteRequestStatus.PENDING,
      );
      expect(result.status).toBe(QuoteRequestStatus.APPROVED);
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('does not update the request if Enterprise subscription activation fails', async () => {
      subscriptionRepo.findActiveByUser.mockResolvedValueOnce({
        id: 'sub-1', userId: 'user-123', organizationId: 'org-123', planTier: PlanTier.PROFESSIONAL,
      });
      quoteRequestRepo.findById.mockResolvedValue({
        id: validQuoteId,
        userId: 'user-123',
        organizationId: 'org-123',
        status: QuoteRequestStatus.PENDING,
      });
      subscriptionRepo.updatePlan.mockRejectedValue(new Error('subscription repository unavailable'));

      await expect(service.updateQuoteRequestStatus(adminUser, validQuoteId, QuoteRequestStatus.APPROVED))
        .rejects.toThrow(ServiceUnavailableException);
      expect(quoteRequestRepo.updateStatus).not.toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('rejects malformed request ids without opening a transaction', async () => {
      await expect(service.updateQuoteRequestStatus(adminUser, 'bad-id', QuoteRequestStatus.APPROVED))
        .rejects.toThrow(BadRequestException);
      expect(mockConnection.startSession).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException on invalid transition from CONTACTED to PENDING', async () => {
      quoteRequestRepo.findById.mockResolvedValue({
        id: validQuoteId,
        status: QuoteRequestStatus.CONTACTED,
      });

      await expect(
        service.updateQuoteRequestStatus(adminUser, validQuoteId, QuoteRequestStatus.PENDING),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on modifying a CLOSED quote request', async () => {
      quoteRequestRepo.findById.mockResolvedValue({
        id: validQuoteId,
        status: QuoteRequestStatus.CLOSED,
      });

      await expect(
        service.updateQuoteRequestStatus(adminUser, validQuoteId, QuoteRequestStatus.CONTACTED),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
