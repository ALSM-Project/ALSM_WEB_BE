import { Test, TestingModule } from '@nestjs/testing';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from '../../application/services/bank-account.service';
import { JwtAuthGuard } from '../../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../../shared/security/permissions.guard';

describe('BankAccountController', () => {
  let controller: BankAccountController;
  let service: BankAccountService;

  const mockService = {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setDefault: jest.fn(),
    deactivate: jest.fn(),
    reactivate: jest.fn(),
    revealAccountNumber: jest.fn(),
  };

  const mockUser: any = {
    userId: '507f1f77bcf86cd799439011',
    email: 'admin@alsm.io',
    roles: ['ADMIN'],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BankAccountController],
      providers: [
        { provide: BankAccountService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BankAccountController>(BankAccountController);
    service = module.get<BankAccountService>(BankAccountService);
  });

  it('delegates list call to service', async () => {
    const query = { page: 1, limit: 10 };
    mockService.list.mockResolvedValue({ items: [], pagination: { total: 0 } });

    const result = await controller.list(query as any);
    expect(service.list).toHaveBeenCalledWith(query);
    expect(result).toBeDefined();
  });

  it('delegates create call with actor user id', async () => {
    const dto: any = {
      bankName: 'VCB',
      accountHolderName: 'ALSM',
      accountNumber: '123456789',
      currency: 'VND',
    };
    mockService.create.mockResolvedValue({ id: '1', ...dto });

    const result = await controller.create(dto, mockUser);
    expect(service.create).toHaveBeenCalledWith(dto, mockUser.userId);
    expect(result.id).toBe('1');
  });

  it('delegates setDefault call with actor user id', async () => {
    mockService.setDefault.mockResolvedValue({ id: '1', isDefault: true });

    const result = await controller.setDefault('1', mockUser);
    expect(service.setDefault).toHaveBeenCalledWith('1', mockUser.userId);
    expect(result.isDefault).toBe(true);
  });

  it('delegates deactivate call with reason and actor user id', async () => {
    mockService.deactivate.mockResolvedValue({ id: '1', status: 'inactive' });

    const result = await controller.deactivate('1', { reason: 'Closure' }, mockUser);
    expect(service.deactivate).toHaveBeenCalledWith('1', 'Closure', mockUser.userId);
    expect(result.status).toBe('inactive');
  });

  it('delegates revealAccountNumber call with actor user id', async () => {
    mockService.revealAccountNumber.mockResolvedValue({ id: '1', accountNumber: '123456789' });

    const result = await controller.revealAccountNumber('1', mockUser);
    expect(service.revealAccountNumber).toHaveBeenCalledWith('1', mockUser.userId);
    expect(result.accountNumber).toBe('123456789');
  });
});
