import { AuditLogService } from '../src/modules/admin/application/audit-log.service';

describe('AuditLogService (UC 3.13.10)', () => {
  let auditModel: {
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let service: AuditLogService;

  beforeEach(() => {
    auditModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
            }),
          }),
        }),
      }),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    service = new AuditLogService(auditModel as never);
  });

  it('builds a date-range filter when from and to are provided', async () => {
    await service.list({ from: '2026-01-01', to: '2026-01-31' });

    expect(auditModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: {
          $gte: expect.any(Date),
          $lte: expect.any(Date),
        },
      }),
    );
  });

  it('filters by actor, resource type, and resource id', async () => {
    await service.list({
      actorUserId: 'user-1',
      resourceType: 'USER',
      resourceId: 'res-1',
    });

    expect(auditModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        resourceType: 'USER',
        resourceId: 'res-1',
      }),
    );
  });

  it('clamps page and limit to safe bounds', async () => {
    const result = await service.list({ page: 0, limit: 9999 });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(100);
  });
});
