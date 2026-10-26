import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlatformAdminService } from '../src/modules/admin/application/platform-admin.service';
import { Organization } from '../src/modules/organizations/infrastructure/organization.schema';
import { User } from '../src/modules/users/infrastructure/user.schema';
import { UserSession } from '../src/modules/auth/infrastructure/user-session.schema';
import { EngagementType } from '../src/modules/organizations/infrastructure/engagement-type.schema';
import { Project } from '../src/modules/projects/infrastructure/project.schema';
import { ConversionJob } from '../src/modules/conversions/infrastructure/conversion-job.schema';
import { AuditLog } from '../src/modules/audit/infrastructure/audit-log.schema';
import { AUDIT_REPOSITORY } from '../src/modules/audit/domain/audit.repository';

describe('[UC-72] View Organisation Details Service', () => {
  let service: PlatformAdminService;

  const validOrgId = new Types.ObjectId().toString();
  const validUserId = new Types.ObjectId().toString();

  const mockOrgDoc = {
    _id: new Types.ObjectId(validOrgId),
    id: validOrgId,
    name: 'Apex Modernization Corp',
    type: 'ENTERPRISE',
    status: 'ACTIVE',
    domain: 'apex.corp',
    contactEmail: 'contact@apex.corp',
    engagementType: 'ENTERPRISE_T2',
    trialExpiresAt: new Date('2026-12-31'),
    limits: {
      maxScreens: 50,
      maxPrograms: 25,
      maxStorageGb: 100,
    },
    members: [
      {
        userId: new Types.ObjectId(validUserId),
        role: 'OWNER',
      },
    ],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-06-01'),
  };

  const mockUserDoc = {
    _id: new Types.ObjectId(validUserId),
    fullName: 'Jane Doe',
    email: 'jane@apex.corp',
    isActive: true,
  };

  const mockProjectDocs = [
    {
      _id: new Types.ObjectId(),
      name: 'AS400 Core Migration',
      conversionType: 'COBOL_TO_JAVA',
      status: 'IN_PROGRESS',
      isDemo: false,
      createdAt: new Date('2026-03-01'),
    },
  ];

  const mockOrgModel = {
    findById: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockUserModel = {
    find: jest.fn(),
  };

  const mockProjectModel = {
    countDocuments: jest.fn(),
    find: jest.fn(),
  };

  const mockJobModel = {
    countDocuments: jest.fn(),
  };

  const mockSessionModel = {
    find: jest.fn(),
  };

  const mockEngagementModel = {
    find: jest.fn(),
  };

  const mockAuditModel = {
    find: jest.fn(),
  };

  const mockAuditRepo = {
    append: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformAdminService,
        { provide: getModelToken(Organization.name), useValue: mockOrgModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(UserSession.name), useValue: mockSessionModel },
        { provide: getModelToken(EngagementType.name), useValue: mockEngagementModel },
        { provide: getModelToken(Project.name), useValue: mockProjectModel },
        { provide: getModelToken(ConversionJob.name), useValue: mockJobModel },
        { provide: getModelToken(AuditLog.name), useValue: mockAuditModel },
        { provide: AUDIT_REPOSITORY, useValue: mockAuditRepo },
      ],
    }).compile();

    service = module.get<PlatformAdminService>(PlatformAdminService);
  });

  it('1. Successfully retrieves complete organisation details with members and projects', async () => {
    mockOrgModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockOrgDoc),
    });

    mockProjectModel.countDocuments.mockResolvedValue(1);
    mockJobModel.countDocuments.mockResolvedValue(5);

    mockUserModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([mockUserDoc]),
    });

    mockProjectModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockProjectDocs),
        }),
      }),
    });

    const result = await service.getOrganizationDetails(validOrgId);

    expect(result).toBeDefined();
    expect(result.id).toBe(validOrgId);
    expect(result.name).toBe('Apex Modernization Corp');
    expect(result.type).toBe('ENTERPRISE');
    expect(result.status).toBe('ACTIVE');
    expect(result.domain).toBe('apex.corp');
    expect(result.contactEmail).toBe('contact@apex.corp');
    expect(result.engagementType).toBe('ENTERPRISE_T2');
    expect(result.projectCount).toBe(1);
    expect(result.conversionJobCount).toBe(5);

    // Verify members populated with full names
    expect(result.members).toHaveLength(1);
    expect(result.members[0].fullName).toBe('Jane Doe');
    expect(result.members[0].email).toBe('jane@apex.corp');
    expect(result.members[0].role).toBe('OWNER');

    // Verify projects populated
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('AS400 Core Migration');
    expect(result.projects[0].conversionType).toBe('COBOL_TO_JAVA');

    // Verify usage stats
    expect(result.usageStats).toBeDefined();
    expect(result.usageStats.activeProjects).toBe(1);
    expect(result.usageStats.totalScreensConverted).toBe(5);
  });

  it('2. Throws NotFoundException when organisation does not exist', async () => {
    mockOrgModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    mockOrgModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(service.getOrganizationDetails(validOrgId)).rejects.toThrow(
      NotFoundException
    );
  });

  it('3. Throws BadRequestException when organisation ID is empty', async () => {
    await expect(service.getOrganizationDetails('')).rejects.toThrow(
      BadRequestException
    );
    await expect(service.getOrganizationDetails('   ')).rejects.toThrow(
      BadRequestException
    );
  });
});
