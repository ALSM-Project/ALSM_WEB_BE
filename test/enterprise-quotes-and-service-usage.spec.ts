import { Model, Types } from 'mongoose';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { SalesCrmService } from '../src/modules/crm/application/sales-crm.service';
import { Lead } from '../src/modules/crm/infrastructure/lead.schema';
import { User } from '../src/modules/users/infrastructure/user.schema';
import { Organization } from '../src/modules/organizations/infrastructure/organization.schema';
import { Project } from '../src/modules/projects/infrastructure/project.schema';
import { ConversionJob } from '../src/modules/conversions/infrastructure/conversion-job.schema';

describe('Enterprise Quotes and Service Usage', () => {
  const leadFindQuery = {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };
  const leadModel = {
    find: jest.fn().mockReturnValue(leadFindQuery),
    findById: jest.fn(),
    findOne: jest.fn(),
  } as unknown as Model<Lead>;

  const userModel = {} as unknown as Model<User>;
  const audit = { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditRepository;

  const orgFindQuery = {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };
  const orgModel = {
    find: jest.fn().mockReturnValue(orgFindQuery),
  } as unknown as Model<Organization>;

  const projectModel = {
    countDocuments: jest.fn().mockResolvedValue(3),
  } as unknown as Model<Project>;

  const conversionJobModel = {
    countDocuments: jest.fn().mockResolvedValue(15),
  } as unknown as Model<ConversionJob>;

  let service: SalesCrmService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SalesCrmService(
      leadModel,
      userModel,
      audit,
      orgModel,
      projectModel,
      conversionJobModel,
    );
  });

  describe('listAllQuotes', () => {
    it('aggregates quotes across leads with formatted quote numbers', async () => {
      const mockLeads = [
        {
          _id: new Types.ObjectId(),
          contactName: 'John Doe',
          company: 'Acme Corp',
          contactEmail: 'john@acme.com',
          quotes: [
            {
              id: 'quote-12345678',
              quoteNumber: 'QTE-2026-1001',
              planName: 'Enterprise Managed',
              serviceType: 'ALSM_MANAGED',
              amount: 50000000,
              finalPrice: 45000000,
              discountPercent: 10,
              status: 'SENT',
              createdAt: new Date(),
            },
          ],
        },
      ];
      leadFindQuery.exec.mockResolvedValue(mockLeads);

      const quotes = await service.listAllQuotes();
      expect(quotes).toHaveLength(1);
      expect(quotes[0].quoteNumber).toBe('QTE-2026-1001');
      expect(quotes[0].companyName).toBe('Acme Corp');
      expect(quotes[0].serviceType).toBe('ALSM_MANAGED');
    });
  });

  describe('createEnterpriseQuote', () => {
    it('creates quote and sets approval status when discount is >= 15%', async () => {
      const existingLead = {
        _id: new Types.ObjectId(),
        contactName: 'Jane Smith',
        company: 'Fintech Corp',
        contactEmail: 'jane@fintech.com',
        stage: 'QUALIFIED',
        quotes: [] as any[],
        save: jest.fn().mockResolvedValue(true),
        organizationId: new Types.ObjectId(),
      };
      (leadModel.findById as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue(existingLead),
      });

      const result = await service.createEnterpriseQuote('user-1', undefined, {
        leadId: existingLead._id.toString(),
        customerName: 'Jane Smith',
        customerEmail: 'jane@fintech.com',
        companyName: 'Fintech Corp',
        serviceType: 'CUSTOMER_SELF_SERVICE',
        servicePackage: 'Enterprise',
        baseFee: 100000000,
        discountPercent: 20,
        discountReason: 'Volume commitment',
      });

      expect(result.success).toBe(true);
      expect(result.quote.discountPercent).toBe(20);
      expect(result.quote.approvalStatus).toBe('PENDING');
      expect(result.quote.status).toBe('PENDING_APPROVAL');
      expect(existingLead.quotes).toHaveLength(1);
      expect(existingLead.stage).toBe('PROPOSAL');
      expect(existingLead.save).toHaveBeenCalled();
    });
  });

  describe('getEnterpriseServiceUsage', () => {
    it('aggregates organization limits, conversions, and projects', async () => {
      const mockOrgs = [
        {
          _id: new Types.ObjectId(),
          name: 'MegaBank',
          domain: 'megabank.vn',
          serviceMode: 'ALSM_MANAGED',
          engagementType: 'Enterprise Managed',
          status: 'ACTIVE',
          limits: {
            maxScreens: 50,
            maxPrograms: 20,
            maxProjects: 5,
            maxStorageGb: 10,
          },
          contractCapacity: {
            screenCapacity: 50,
            programCapacity: 20,
            projectCapacity: 5,
            userSeats: 8,
            storageGb: 10,
          },
        },
      ];
      orgFindQuery.exec.mockResolvedValue(mockOrgs);

      const usage = await service.getEnterpriseServiceUsage();
      expect(usage.items).toHaveLength(1);
      expect(usage.items[0].name).toBe('MegaBank');
      expect(usage.items[0].serviceMode).toBe('ALSM_MANAGED');
      expect(usage.items[0].screenCapacity.allocated).toBe(50);
      expect(usage.items[0].screenCapacity.used).toBe(15);
      expect(usage.items[0].screenCapacity.remaining).toBe(35);
      expect(usage.items[0].screenCapacity.pct).toBe(30);
      expect(usage.items[0].usageStatus).toBe('ACTIVE');
      expect(usage.summary.totalAllocatedScreens).toBe(50);
      expect(usage.summary.totalUsedScreens).toBe(15);
    });
  });
});
