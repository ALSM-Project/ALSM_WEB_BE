import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BankAccountService } from './bank-account.service';
import { BankAccountEncryptionService } from '../../infrastructure/bank-account-encryption.service';
import { ConfigService } from '@nestjs/config';

describe('BankAccountService', () => {
  let service: BankAccountService;
  let encryption: BankAccountEncryptionService;
  let mockModel: any;
  let mockAudit: any;

  beforeEach(() => {
    const config = new ConfigService({
      BANK_ACCOUNT_ENCRYPTION_KEY: Buffer.alloc(32, 'a').toString('base64'),
    });
    encryption = new BankAccountEncryptionService(config);

    mockAudit = {
      append: jest.fn().mockResolvedValue(undefined),
    };

    mockModel = {
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    service = new BankAccountService(mockModel, encryption, mockAudit);
  });

  describe('create', () => {
    it('creates a new receiving bank account and encrypts account number', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const fakeDoc = {
        _id: '507f1f77bcf86cd799439011',
        id: '507f1f77bcf86cd799439011',
        bankName: 'Vietcombank',
        bankCode: 'VCB',
        bin: '970436',
        accountHolderName: 'ALSM COMPANY',
        accountNumberLast4: '7890',
        accountNumberEncrypted: 'v1.iv.cipher.tag',
        currency: 'VND',
        country: 'VN',
        branchName: 'Hanoi Branch',
        status: 'active',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockModel.create.mockResolvedValue(fakeDoc);

      const result = await service.create(
        {
          bankName: 'Vietcombank',
          bankCode: 'VCB',
          bin: '970436',
          accountHolderName: 'ALSM COMPANY',
          accountNumber: '01234567890',
          currency: 'VND',
          branchName: 'Hanoi Branch',
          isDefault: true,
          status: 'active',
        },
        '507f1f77bcf86cd799439012',
      );

      expect(result.bankName).toBe('Vietcombank');
      expect(result.bin).toBe('970436');
      expect(result.accountNumberMasked).toBe('•••• •••• 7890');
      expect(result.accountNumberLast4).toBe('7890');
      // Must not expose full plaintext account number or encrypted string
      expect((result as any).accountNumber).toBeUndefined();
      expect((result as any).accountNumberEncrypted).toBeUndefined();

      // Atomic default management must be called
      expect(mockModel.updateMany).toHaveBeenCalledWith(
        { currency: 'VND', isDefault: true },
        { $set: { isDefault: false } },
      );

      // Audit log must be recorded
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BANK_ACCOUNT_CREATED',
          resourceType: 'BANK_ACCOUNT',
          resourceId: fakeDoc.id,
        }),
      );
    });

    it('rejects duplicate bank account with same bank, currency, and number', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'existing-id' }),
      });

      await expect(
        service.create({
          bankName: 'Vietcombank',
          accountHolderName: 'ALSM COMPANY',
          accountNumber: '01234567890',
          currency: 'VND',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects setting inactive account as default', async () => {
      await expect(
        service.create({
          bankName: 'Vietcombank',
          accountHolderName: 'ALSM COMPANY',
          accountNumber: '01234567890',
          currency: 'VND',
          status: 'inactive',
          isDefault: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('setDefault', () => {
    it('atomically sets default for currency and unsets previous default', async () => {
      const fakeDoc = {
        _id: '507f1f77bcf86cd799439011',
        id: '507f1f77bcf86cd799439011',
        bankName: 'Techcombank',
        accountHolderName: 'ALSM COMPANY',
        accountNumberLast4: '4321',
        currency: 'USD',
        status: 'active',
        isDefault: false,
        save: jest.fn().mockResolvedValue(true),
      };

      mockModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(fakeDoc),
      });

      const result = await service.setDefault('507f1f77bcf86cd799439011', 'user-123');

      expect(mockModel.updateMany).toHaveBeenCalledWith(
        { _id: { $ne: fakeDoc._id }, currency: 'USD', isDefault: true },
        { $set: { isDefault: false } },
      );
      expect(fakeDoc.isDefault).toBe(true);
      expect(fakeDoc.save).toHaveBeenCalled();
      expect(result.isDefault).toBe(true);
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BANK_ACCOUNT_DEFAULT_SET',
        }),
      );
    });

    it('rejects setting inactive account as default', async () => {
      mockModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: '507f1f77bcf86cd799439011',
          status: 'inactive',
        }),
      });

      await expect(
        service.setDefault('507f1f77bcf86cd799439011', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deactivate', () => {
    it('soft deactivates and removes default status', async () => {
      const fakeDoc = {
        _id: '507f1f77bcf86cd799439011',
        id: '507f1f77bcf86cd799439011',
        bankName: 'MB Bank',
        accountHolderName: 'ALSM COMPANY',
        accountNumberLast4: '9999',
        currency: 'VND',
        status: 'active',
        isDefault: true,
        deactivationReason: null as string | null,
        save: jest.fn().mockResolvedValue(true),
      };

      mockModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(fakeDoc),
      });

      const result = await service.deactivate('507f1f77bcf86cd799439011', 'Contract expired', 'user-123');

      expect(fakeDoc.status).toBe('inactive');
      expect(fakeDoc.isDefault).toBe(false);
      expect(fakeDoc.deactivationReason).toBe('Contract expired');
      expect(result.status).toBe('inactive');
      expect(result.isDefault).toBe(false);
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BANK_ACCOUNT_DEACTIVATED',
        }),
      );
    });
  });

  describe('revealAccountNumber', () => {
    it('decrypts account number and records audit trail', async () => {
      const rawNumber = '9876543210123';
      const encrypted = encryption.encryptAccountNumber(rawNumber);

      const fakeDoc = {
        _id: '507f1f77bcf86cd799439011',
        id: '507f1f77bcf86cd799439011',
        bankName: 'ACB',
        accountNumberEncrypted: encrypted,
        accountNumberLast4: '0123',
        currency: 'VND',
      };

      mockModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(fakeDoc),
      });

      const result = await service.revealAccountNumber('507f1f77bcf86cd799439011', 'admin-auditor');

      expect(result.accountNumber).toBe(rawNumber);
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BANK_ACCOUNT_REVEALED',
          actorUserId: 'admin-auditor',
        }),
      );
    });
  });
});
