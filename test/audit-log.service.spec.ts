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

  it('filters by target across resourceType and resourceId with regex', async () => {
    await service.list({ target: 'org-42' });

    expect(auditModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [
          { resourceType: expect.any(RegExp) },
          { resourceId: expect.any(RegExp) },
        ],
      }),
    );
  });

  it('formats audit log items with timestamp, actor, target, and ipAddress', async () => {
    const mockDate = new Date('2026-05-01T12:00:00Z');
    auditModel.find = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                {
                  _id: 'log-1',
                  action: 'USER_LOCKED',
                  resourceType: 'USER',
                  resourceId: 'u-123',
                  ipAddress: '10.0.0.1',
                  createdAt: mockDate,
                  actorUserId: { fullName: 'Alice Admin', email: 'alice@example.com' },
                  metadata: { reason: 'Policy violation' },
                },
              ]),
            }),
          }),
        }),
      }),
    });

    const result = await service.list();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      action: 'USER_LOCKED',
      actor: 'Alice Admin',
      target: 'USER:u-123',
      ipAddress: '10.0.0.1',
      timestamp: mockDate,
    });
  });

  it('applies filters to CSV export and includes IP Address header and data', async () => {
    const mockDate = new Date('2026-05-01T12:00:00Z');
    auditModel.find = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                action: 'USER_UNLOCKED',
                resourceType: 'USER',
                resourceId: 'u-456',
                ipAddress: '192.168.1.50',
                createdAt: mockDate,
                actorUserId: { fullName: 'Bob Supervisor' },
                metadata: {},
              },
            ]),
          }),
        }),
      }),
    });

    const csv = await service.exportCsv({ action: 'USER_UNLOCKED' });

    expect(auditModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.any(RegExp) }),
    );
    expect(csv).toContain('Timestamp,Actor,Action,ResourceType,ResourceId,IP Address,Metadata');
    expect(csv).toContain('"Bob Supervisor","USER_UNLOCKED","USER","u-456","192.168.1.50"');
  });

  it('applies filters to PDF export', async () => {
    auditModel.find = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const pdfBuffer = await service.exportPdf({ target: 'org-test' });

    expect(auditModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [
          { resourceType: expect.any(RegExp) },
          { resourceId: expect.any(RegExp) },
        ],
      }),
    );
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
  });
});
