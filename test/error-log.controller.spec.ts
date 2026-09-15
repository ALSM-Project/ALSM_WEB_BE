import { Test, TestingModule } from '@nestjs/testing';
import { ErrorLogController } from '../src/modules/conversions/presentation/error-log.controller';
import { ErrorLogService } from '../src/modules/conversions/application/error-log.service';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';

const mockJwtAuthGuard = {
  canActivate: () => true,
};

describe('ErrorLogController', () => {
  let controller: ErrorLogController;
  let service: ErrorLogService;

  const mockUser = { userId: 'user-1', email: 'test@example.com' };

  const mockErrorLog = {
    id: 'log-1',
    projectId: 'proj-acme',
    code: 'ERR_BMS_UNSUPPORTED_MACRO',
    severity: 'ERROR',
    message: 'Unsupported macro encountered',
    sourceSnippet: 'MAP1 BMS MAP',
    suggestedFix: 'Replace with React component',
  };

  beforeEach(async () => {
    const mockService = {
      list: jest.fn().mockResolvedValue({ data: [mockErrorLog], total: 1, page: 1, limit: 20, totalPages: 1 }),
      getById: jest.fn().mockResolvedValue(mockErrorLog),
      getSummary: jest.fn().mockResolvedValue({ total: 1, fatal: 1, warning: 0, resolved: 0 }),
      resolve: jest.fn().mockResolvedValue({ ...mockErrorLog, status: 'RESOLVED' }),
      ignore: jest.fn().mockResolvedValue({ ...mockErrorLog, status: 'IGNORED' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ErrorLogController],
      providers: [
        {
          provide: ErrorLogService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    controller = module.get<ErrorLogController>(ErrorLogController);
    service = module.get<ErrorLogService>(ErrorLogService);
  });

  it('should return error logs list for a project', async () => {
    const result = await controller.list(mockUser as any, undefined, 'proj-acme', {});

    expect(result).toBeDefined();
    expect(result.data).toHaveLength(1);
    expect(service.list).toHaveBeenCalledWith('user-1', undefined, 'proj-acme', {});
  });

  it('should return error log detail by ID', async () => {
    const result = await controller.getById(mockUser as any, undefined, 'proj-acme', 'log-1');

    expect(result).toBeDefined();
    expect(result.id).toBe('log-1');
    expect(service.getById).toHaveBeenCalledWith('user-1', undefined, 'proj-acme', 'log-1');
  });

  it('should return diagnostic summary statistics', async () => {
    const result = await controller.getSummary(mockUser as any, undefined, 'proj-acme');

    expect(result).toBeDefined();
    expect(result.total).toBe(1);
    expect(service.getSummary).toHaveBeenCalledWith('user-1', undefined, 'proj-acme');
  });

  it('should mark an error log as resolved', async () => {
    const result = await controller.resolve(mockUser as any, undefined, 'proj-acme', 'log-1');

    expect(result).toBeDefined();
    expect(result.status).toBe('RESOLVED');
    expect(service.resolve).toHaveBeenCalledWith('user-1', undefined, 'proj-acme', 'log-1');
  });
});
