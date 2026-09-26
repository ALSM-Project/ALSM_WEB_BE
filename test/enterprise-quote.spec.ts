import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BillingService } from '../src/modules/billing/application/billing.service';
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

  const mockUser: AuthenticatedUser = {
    userId: 'user-123',
    email: 'admin@acme.corp',
    isPlatformAdmin: false,
  };

  beforeEach(async () => {
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

      const result = await service.requestEnterpriseQuote('user-123', 'org-123', {
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
        service.requestEnterpriseQuote('user-123', 'org-123', {
          fullName: 'Jane Doe',
          companyName: 'ACME Enterprise',
          email: 'jane@acme.com',
        }),
      ).rejects.toThrow(ConflictException);

      expect(quoteRequestRepo.create).not.toHaveBeenCalled();
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

      const response = await controller.requestEnterpriseQuote(
        { ...mockUser, organizationId: 'org-123' } as AuthenticatedUser & { organizationId?: string },
        dto,
      );

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

      const result = await service.listQuoteRequests(adminUser, { status: QuoteRequestStatus.PENDING, page: 1, limit: 10 });

      expect(quoteRequestRepo.findAll).toHaveBeenCalledWith({ status: QuoteRequestStatus.PENDING, page: 1, limit: 10 }, 1, 10);
      expect(result.items.length).toBe(1);
      expect(result.total).toBe(1);
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
        service.updateQuoteRequestStatus(mockUser, 'quote-1', QuoteRequestStatus.CONTACTED),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if quote request does not exist', async () => {
      quoteRequestRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateQuoteRequestStatus(adminUser, 'non-existent', QuoteRequestStatus.CONTACTED),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update status from PENDING to CONTACTED for admin', async () => {
      quoteRequestRepo.findById.mockResolvedValue({
        id: 'quote-1',
        status: QuoteRequestStatus.PENDING,
      });
      quoteRequestRepo.updateStatus.mockResolvedValue({
        id: 'quote-1',
        status: QuoteRequestStatus.CONTACTED,
      });

      const result = await service.updateQuoteRequestStatus(adminUser, 'quote-1', QuoteRequestStatus.CONTACTED);

      expect(quoteRequestRepo.updateStatus).toHaveBeenCalledWith('quote-1', QuoteRequestStatus.CONTACTED);
      expect(result.status).toBe(QuoteRequestStatus.CONTACTED);
    });

    it('should throw BadRequestException on invalid transition from CONTACTED to PENDING', async () => {
      quoteRequestRepo.findById.mockResolvedValue({
        id: 'quote-1',
        status: QuoteRequestStatus.CONTACTED,
      });

      await expect(
        service.updateQuoteRequestStatus(adminUser, 'quote-1', QuoteRequestStatus.PENDING),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on modifying a CLOSED quote request', async () => {
      quoteRequestRepo.findById.mockResolvedValue({
        id: 'quote-1',
        status: QuoteRequestStatus.CLOSED,
      });

      await expect(
        service.updateQuoteRequestStatus(adminUser, 'quote-1', QuoteRequestStatus.CONTACTED),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
