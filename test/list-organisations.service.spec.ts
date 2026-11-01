import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Types } from 'mongoose';
import { PlatformAdminService } from '../src/modules/admin/application/platform-admin.service';
import { ListOrganizationsQueryDto } from '../src/modules/admin/presentation/dto/list-organizations-query.dto';

describe('[UC-71] View All Organisations', () => {
  const firstId = new Types.ObjectId();
  const secondId = new Types.ObjectId();
  const organizations = [
    {
      _id: firstId,
      id: firstId.toString(),
      name: 'Apex.* Systems',
      type: 'ENTERPRISE',
      status: 'ACTIVE',
      domain: 'apex.example',
      contactEmail: 'admin@apex.example',
      engagementType: 'ENTERPRISE_T2',
      members: [{ userId: new Types.ObjectId(), role: 'ADMIN' }],
      limits: { maxScreens: 50 },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    },
    {
      _id: secondId,
      id: secondId.toString(),
      name: 'Beta Systems',
      type: 'INTERNAL',
      status: 'SUSPENDED',
      members: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    },
  ];
  let service: PlatformAdminService;
  let find: jest.Mock;
  let aggregate: jest.Mock;

  beforeEach(() => {
    find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(organizations),
    });
    aggregate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([{ _id: firstId, count: 3 }]),
    });
    service = new PlatformAdminService(
      { find } as never,
      {} as never,
      {} as never,
      {} as never,
      { aggregate } as never,
      {} as never,
      {} as never,
      { append: jest.fn() } as never,
    );
  });

  it('returns every matching organisation with real member/project counts and safe search', async () => {
    const result = await service.listOrganizations({ search: 'Apex.*', type: 'ENTERPRISE', status: 'ACTIVE' });

    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ENTERPRISE',
      status: 'ACTIVE',
      $or: expect.any(Array),
    }));
    const filter = find.mock.calls[0][0];
    expect(filter.$or[0].name.test('Apex.* Systems')).toBe(true);
    expect(filter.$or[0].name.test('ApexZZ Systems')).toBe(false);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: firstId.toString(),
      memberCount: 1,
      projectCount: 3,
      engagementType: 'ENTERPRISE_T2',
    });
    expect(result[1]).toMatchObject({
      id: secondId.toString(),
      memberCount: 0,
      projectCount: 0,
      engagementType: 'Trial',
    });
    expect(aggregate.mock.calls[0][0][0].$match.deletedAt).toEqual({ $exists: false });
  });

  it('returns an empty list without querying project counts when no organisations match', async () => {
    find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });

    await expect(service.listOrganizations()).resolves.toEqual([]);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('validates the list filters and limits search input length', () => {
    const invalid = plainToInstance(ListOrganizationsQueryDto, {
      type: 'NOT_A_TYPE',
      status: 'DELETED',
      search: 'x'.repeat(101),
    });
    expect(validateSync(invalid).length).toBeGreaterThan(0);

    const valid = plainToInstance(ListOrganizationsQueryDto, {
      type: 'PARTNER',
      status: 'TRIAL',
      search: 'Acme',
    });
    expect(validateSync(valid)).toEqual([]);
  });

  it('returns a secret-free retryable dependency error when the directory cannot be read', async () => {
    find.mockImplementation(() => { throw new Error('private Mongo credentials'); });

    await expect(service.listOrganizations()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.listOrganizations()).rejects.toMatchObject({
      response: {
        code: 'ORGANIZATION_LIST_UNAVAILABLE',
        message: 'Organisations are temporarily unavailable. Please retry.',
      },
    });
  });
});
