import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { getConnectionToken } from '@nestjs/mongoose';
import { Response } from 'express';
import { BillingController } from '../src/modules/billing/presentation/billing.controller';
import { BillingService } from '../src/modules/billing/application/billing.service';
import { UsageService } from '../src/modules/billing/application/usage.service';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../src/shared/logging/request-id.middleware';
import {
  INVOICE_REPOSITORY,
  PLAN_REPOSITORY,
  QUOTE_REQUEST_REPOSITORY,
  SUBSCRIPTION_REPOSITORY,
} from '../src/modules/billing/domain/billing.repository.interface';
import { InvoiceStatus, PlanTier } from '../src/modules/billing/domain/billing.types';
import { ListInvoicesQueryDto } from '../src/modules/billing/presentation/billing.dto';

describe('View Invoices Workflow (Enterprise Customer & Enterprise Admin)', () => {
  let controller: BillingController;
  let service: BillingService;

  const mockOrgId = '66d9c84e1234567890abcdef';
  const otherOrgId = '66d9c84e1234567890abc999';
  const mockUserId = '66d9c84e1234567890abc001';
  const otherUserId = '66d9c84e1234567890abc002';
  const mockInvoiceId = '66d9c84e1234567890abc111';

  const enterpriseAdminUser: AuthenticatedUser = {
    userId: mockUserId,
    email: 'admin@enterprise.com',
    isPlatformAdmin: false,
  };

  const enterpriseCustomerUser: AuthenticatedUser = {
    userId: mockUserId,
    email: 'customer@enterprise.com',
    isPlatformAdmin: false,
  };

  const platformAdminUser: AuthenticatedUser = {
    userId: '66d9c84e1234567890abc888',
    email: 'admin@alsm.io',
    isPlatformAdmin: true,
  };

  const unauthorizedUser: AuthenticatedUser = {
    userId: otherUserId,
    email: 'stranger@other.com',
    isPlatformAdmin: false,
  };

  const mockInvoice = {
    id: mockInvoiceId,
    invoiceNumber: 'INV-2026-0001',
    planTier: PlanTier.ENTERPRISE,
    planName: 'Enterprise Modernization Pilot',
    amountVnd: 150000000,
    status: InvoiceStatus.PAID,
    userId: mockUserId,
    organizationId: mockOrgId,
    billingPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
    billingPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    paidAt: new Date('2026-08-02T10:00:00.000Z'),
    paymentMethod: 'Bank Wire Transfer',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  let invoiceRepo: {
    findById: jest.Mock;
    findRecentByUser: jest.Mock;
    findInvoices: jest.Mock;
    countDocuments: jest.Mock;
    create: jest.Mock;
    markPaid: jest.Mock;
  };

  let orgContextService: {
    resolve: jest.Mock;
  };

  beforeEach(async () => {
    invoiceRepo = {
      findById: jest.fn(),
      findRecentByUser: jest.fn(),
      findInvoices: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(1),
      create: jest.fn(),
      markPaid: jest.fn(),
    };

    orgContextService = {
      resolve: jest.fn().mockImplementation((userId: string, requestedOrgId?: string) => {
        if (userId === mockUserId && (!requestedOrgId || requestedOrgId === mockOrgId)) {
          return Promise.resolve({
            id: mockOrgId,
            name: 'Acme Enterprise Corp',
            type: 'ENTERPRISE',
            members: [{ userId: mockUserId, role: 'ADMIN' }],
          });
        }
        throw new ForbiddenException({
          code: 'ORGANIZATION_ACCESS_DENIED',
          message: 'You do not have access to this organization',
        });
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        BillingService,
        {
          provide: getConnectionToken(),
          useValue: { startSession: jest.fn() },
        },
        {
          provide: OrganizationContextService,
          useValue: orgContextService,
        },
        {
          provide: UsageService,
          useValue: { getUsageStats: jest.fn() },
        },
        {
          provide: INVOICE_REPOSITORY,
          useValue: invoiceRepo,
        },
        {
          provide: SUBSCRIPTION_REPOSITORY,
          useValue: {
            findActiveByUser: jest.fn(),
            findLatestByUser: jest.fn(),
            create: jest.fn(),
            updatePlan: jest.fn(),
            updateStatus: jest.fn(),
            cancel: jest.fn(),
          },
        },
        {
          provide: PLAN_REPOSITORY,
          useValue: {
            findAllActive: jest.fn().mockResolvedValue([]),
            findByTier: jest.fn(),
            seedDefaults: jest.fn(),
          },
        },
        {
          provide: QUOTE_REQUEST_REPOSITORY,
          useValue: {
            findPendingByUser: jest.fn(),
            findLatestByUser: jest.fn(),
            create: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BillingController>(BillingController);
    service = module.get<BillingService>(BillingService);
  });

  describe('Validation: ListInvoicesQueryDto', () => {
    it('should pass validation for valid query parameters', async () => {
      const dto = plainToInstance(ListInvoicesQueryDto, {
        page: 1,
        limit: 20,
        status: InvoiceStatus.PAID,
        planTier: PlanTier.ENTERPRISE,
        search: 'INV-2026',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when page is less than 1', async () => {
      const dto = plainToInstance(ListInvoicesQueryDto, { page: 0 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('min');
    });

    it('should fail validation when limit exceeds 100', async () => {
      const dto = plainToInstance(ListInvoicesQueryDto, { limit: 150 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('max');
    });

    it('should fail validation when status is invalid enum', async () => {
      const dto = plainToInstance(ListInvoicesQueryDto, { status: 'UNKNOWN_STATUS' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('isEnum');
    });
  });

  describe('BillingService.getInvoices', () => {
    it('should automatically scope queries to enterprise organization for enterprise members', async () => {
      invoiceRepo.findInvoices.mockResolvedValue({
        items: [mockInvoice],
        total: 1,
      });

      const res = await service.getInvoices(enterpriseCustomerUser, { page: 1, limit: 10 });

      expect(orgContextService.resolve).toHaveBeenCalledWith(mockUserId);
      expect(invoiceRepo.findInvoices).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: mockOrgId,
          skip: 0,
          limit: 10,
        }),
      );
      expect(res.items.length).toBe(1);
      expect(res.total).toBe(1);
      expect(res.totalPages).toBe(1);
    });

    it('should allow enterprise admin to filter by their organizationId', async () => {
      invoiceRepo.findInvoices.mockResolvedValue({
        items: [mockInvoice],
        total: 1,
      });

      const res = await service.getInvoices(enterpriseAdminUser, {
        organizationId: mockOrgId,
        status: InvoiceStatus.PAID,
      });

      expect(orgContextService.resolve).toHaveBeenCalledWith(mockUserId, mockOrgId);
      expect(res.items[0].status).toBe(InvoiceStatus.PAID);
    });

    it('should reject request when non-member tries to view another organization invoices', async () => {
      await expect(
        service.getInvoices(unauthorizedUser, { organizationId: otherOrgId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow platform admin to view invoices across all organizations', async () => {
      invoiceRepo.findInvoices.mockResolvedValue({
        items: [mockInvoice],
        total: 1,
      });

      const res = await service.getInvoices(platformAdminUser, { page: 1 });

      expect(orgContextService.resolve).not.toHaveBeenCalled();
      expect(invoiceRepo.findInvoices).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: undefined,
          organizationId: undefined,
        }),
      );
      expect(res.items.length).toBe(1);
    });
  });

  describe('BillingService.getInvoiceById', () => {
    it('should reject invalid invoice ID format with 400 BadRequestException', async () => {
      await expect(
        service.getInvoiceById(enterpriseCustomerUser, 'invalid-id-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw 404 NotFoundException if invoice does not exist', async () => {
      invoiceRepo.findById.mockResolvedValue(null);

      await expect(
        service.getInvoiceById(enterpriseCustomerUser, mockInvoiceId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow enterprise customer / admin in the same organization to view details', async () => {
      invoiceRepo.findById.mockResolvedValue(mockInvoice);

      const detail = await service.getInvoiceById(enterpriseCustomerUser, mockInvoiceId);

      expect(detail.id).toBe(mockInvoiceId);
      expect(detail.invoiceNumber).toBe('INV-2026-0001');
      expect(detail.amountVnd).toBe(150000000);
      expect(detail.subtotalVnd).toBe(150000000);
      expect(detail.taxAmountVnd).toBe(15000000); // 10% VAT
      expect(detail.totalAmountVnd).toBe(165000000);
      expect(detail.lineItems.length).toBeGreaterThan(0);
      expect(detail.paymentDetails).toBeDefined();
      expect(detail.paymentDetails?.bankName).toContain('MB Bank');
    });

    it('should reject non-member with 403 ForbiddenException', async () => {
      invoiceRepo.findById.mockResolvedValue(mockInvoice);

      await expect(
        service.getInvoiceById(unauthorizedUser, mockInvoiceId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow platform admin to view any invoice detail', async () => {
      invoiceRepo.findById.mockResolvedValue(mockInvoice);

      const detail = await service.getInvoiceById(platformAdminUser, mockInvoiceId);
      expect(detail.id).toBe(mockInvoiceId);
    });
  });

  describe('BillingService.downloadInvoicePdf', () => {
    it('should generate a valid PDF 1.4 buffer for the invoice', async () => {
      invoiceRepo.findById.mockResolvedValue(mockInvoice);

      const result = await service.downloadInvoicePdf(enterpriseCustomerUser, mockInvoiceId);

      expect(result.invoiceNumber).toBe('INV-2026-0001');
      expect(result.filename).toBe('INV-2026-0001.pdf');
      expect(Buffer.isBuffer(result.buffer)).toBe(true);

      const header = result.buffer.slice(0, 8).toString('utf8');
      expect(header).toContain('%PDF-1.4');
    });
  });

  describe('BillingController Endpoints', () => {
    it('GET /billing/invoices returns direct array when no pagination parameters are supplied (Web 1 compatibility)', async () => {
      invoiceRepo.findInvoices.mockResolvedValue({
        items: [mockInvoice],
        total: 1,
      });

      const result = await controller.getInvoices(enterpriseCustomerUser, {});
      expect(Array.isArray(result)).toBe(true);
      expect((result as any)[0].invoiceNumber).toBe('INV-2026-0001');
    });

    it('GET /billing/invoices returns paginated object when page is provided', async () => {
      invoiceRepo.findInvoices.mockResolvedValue({
        items: [mockInvoice],
        total: 1,
      });

      const result = (await controller.getInvoices(enterpriseCustomerUser, { page: 1, limit: 10 })) as any;
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('GET /billing/invoices/:id returns full detail response', async () => {
      invoiceRepo.findById.mockResolvedValue(mockInvoice);

      const result = await controller.getInvoiceById(enterpriseCustomerUser, mockInvoiceId);
      expect(result.id).toBe(mockInvoiceId);
      expect(result.downloadUrl).toBe(`/api/v1/billing/invoices/${mockInvoiceId}/receipt.pdf`);
      expect(result.lineItems).toBeDefined();
    });

    it('GET /billing/invoices/:id/receipt.pdf streams PDF with application/pdf header', async () => {
      invoiceRepo.findById.mockResolvedValue(mockInvoice);

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.streamInvoicePdf(enterpriseCustomerUser, mockInvoiceId, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('INV-2026-0001.pdf'),
      );
      expect(mockRes.send).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('GET /billing/invoices/:id/download returns download metadata', async () => {
      invoiceRepo.findById.mockResolvedValue(mockInvoice);

      const result = await controller.downloadInvoicePdf(enterpriseCustomerUser, mockInvoiceId);
      expect(result.downloadUrl).toBe(`/api/v1/billing/invoices/${mockInvoiceId}/receipt.pdf`);
      expect(result.invoiceNumber).toBe('INV-2026-0001');
      expect(result.filename).toBe('INV-2026-0001.pdf');
    });
  });
});
