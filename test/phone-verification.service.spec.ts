import * as bcrypt from 'bcrypt';
import { PhoneVerificationService } from '../src/modules/auth/application/phone-verification.service';
import type { SmsVerificationPort } from '../src/modules/auth/domain/sms-verification.port';
import type {
  PhoneVerificationRecord,
  PhoneVerificationRepository,
  CreatePhoneVerificationInput,
} from '../src/modules/auth/domain/phone-verification.repository';

describe('PhoneVerificationService', () => {
  let service: PhoneVerificationService;
  let smsPort: jest.Mocked<SmsVerificationPort>;
  let repo: jest.Mocked<PhoneVerificationRepository>;

  const userId = '64f8a1b2c3d4e5f6a7b8c9d0';
  const phone = '+84901234567';

  beforeEach(() => {
    smsPort = {
      sendOtp: jest.fn().mockResolvedValue({ accepted: true, providerMessageId: 'sms-msg-123' }),
    };

    repo = {
      create: jest.fn().mockImplementation((input: CreatePhoneVerificationInput) =>
        Promise.resolve({
          id: 'rec-1',
          userId: input.userId,
          phone: input.phone,
          tokenHash: input.tokenHash,
          codeHash: input.codeHash,
          expiresAt: input.expiresAt,
          createdAt: new Date(),
          failedAttempts: 0,
        } as PhoneVerificationRecord),
      ),
      findLatestActive: jest.fn().mockResolvedValue(null),
      consumeActive: jest.fn().mockResolvedValue(true),
      incrementFailedAttempts: jest.fn().mockResolvedValue(1),
      revokeAllForUserPhone: jest.fn().mockResolvedValue(undefined),
      countRecentByUserPhone: jest.fn().mockResolvedValue(0),
    };

    service = new PhoneVerificationService(smsPort, repo);
  });

  describe('requestOtp', () => {
    it('successfully requests OTP, hashes code, revokes old records, and sends SMS', async () => {
      const result = await service.requestOtp(userId, phone);

      expect(result.sent).toBe(true);
      expect(result.retryAfterSeconds).toBe(60);
      expect(repo.countRecentByUserPhone).toHaveBeenCalledTimes(2);
      expect(repo.revokeAllForUserPhone).toHaveBeenCalledWith(userId, phone);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          phone,
          tokenHash: expect.any(String),
          codeHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
      expect(smsPort.sendOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          phone,
          code: expect.stringMatching(/^\d{6}$/),
          purpose: 'xác minh số điện thoại',
        }),
      );
    });

    it('enforces 60-second cooldown between requests', async () => {
      const activeRecord: PhoneVerificationRecord = {
        id: 'rec-1',
        userId,
        phone,
        tokenHash: 'thash',
        codeHash: 'chash',
        expiresAt: new Date(Date.now() + 240_000),
        createdAt: new Date(Date.now() - 20_000), // 20s ago
        failedAttempts: 0,
      };
      repo.findLatestActive.mockResolvedValueOnce(activeRecord);

      const result = await service.requestOtp(userId, phone);

      expect(result.sent).toBe(false);
      expect(result.retryAfterSeconds).toBe(40);
      expect(repo.create).not.toHaveBeenCalled();
      expect(smsPort.sendOtp).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if rate limit of 3 requests / 10 mins is exceeded', async () => {
      repo.countRecentByUserPhone.mockResolvedValueOnce(3);

      await expect(service.requestOtp(userId, phone)).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PHONE_OTP_RATE_LIMITED' }),
        }),
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if daily limit of 10 requests is exceeded', async () => {
      repo.countRecentByUserPhone
        .mockResolvedValueOnce(1) // 10-min window check passes
        .mockResolvedValueOnce(10); // daily check fails

      await expect(service.requestOtp(userId, phone)).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PHONE_OTP_DAILY_LIMIT' }),
        }),
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('throws ServiceUnavailableException if SMS gateway fails', async () => {
      smsPort.sendOtp.mockRejectedValueOnce(new Error('SMS Gateway Down'));

      await expect(service.requestOtp(userId, phone)).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'SMS_DELIVERY_FAILED' }),
        }),
      );
    });
  });

  describe('verifyOtp', () => {
    it('consumes OTP and returns true when code is valid', async () => {
      const plainCode = '123456';
      const codeHash = await bcrypt.hash(plainCode, 10);
      const record: PhoneVerificationRecord = {
        id: 'rec-1',
        userId,
        phone,
        tokenHash: 'hash',
        codeHash,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        failedAttempts: 0,
      };
      repo.findLatestActive.mockResolvedValueOnce(record);

      const verified = await service.verifyOtp(userId, phone, plainCode);

      expect(verified).toBe(true);
      expect(repo.consumeActive).toHaveBeenCalledWith('rec-1', userId);
    });

    it('throws PHONE_OTP_NOT_FOUND when no active code exists', async () => {
      repo.findLatestActive.mockResolvedValueOnce(null);

      await expect(service.verifyOtp(userId, phone, '123456')).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PHONE_OTP_NOT_FOUND' }),
        }),
      );
    });

    it('throws PHONE_OTP_LOCKED when failed attempts reach threshold', async () => {
      const record: PhoneVerificationRecord = {
        id: 'rec-1',
        userId,
        phone,
        tokenHash: 'hash',
        codeHash: 'hash',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        failedAttempts: 5,
      };
      repo.findLatestActive.mockResolvedValueOnce(record);

      await expect(service.verifyOtp(userId, phone, '123456')).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PHONE_OTP_LOCKED' }),
        }),
      );
    });

    it('throws PHONE_OTP_EXPIRED when code is expired', async () => {
      const record: PhoneVerificationRecord = {
        id: 'rec-1',
        userId,
        phone,
        tokenHash: 'hash',
        codeHash: 'hash',
        expiresAt: new Date(Date.now() - 1000), // expired
        createdAt: new Date(Date.now() - 300_000),
        failedAttempts: 0,
      };
      repo.findLatestActive.mockResolvedValueOnce(record);

      await expect(service.verifyOtp(userId, phone, '123456')).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PHONE_OTP_EXPIRED' }),
        }),
      );
    });

    it('increments failedAttempts and throws PHONE_OTP_INVALID on mismatch', async () => {
      const correctCode = '123456';
      const codeHash = await bcrypt.hash(correctCode, 10);
      const record: PhoneVerificationRecord = {
        id: 'rec-1',
        userId,
        phone,
        tokenHash: 'hash',
        codeHash,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        failedAttempts: 1,
      };
      repo.findLatestActive.mockResolvedValueOnce(record);
      repo.incrementFailedAttempts.mockResolvedValueOnce(2);

      await expect(service.verifyOtp(userId, phone, '999999')).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PHONE_OTP_INVALID' }),
        }),
      );
      expect(repo.incrementFailedAttempts).toHaveBeenCalledWith('rec-1');
      expect(repo.consumeActive).not.toHaveBeenCalled();
    });

    it('throws PHONE_OTP_ALREADY_USED if conditional write fails (race condition)', async () => {
      const plainCode = '123456';
      const codeHash = await bcrypt.hash(plainCode, 10);
      const record: PhoneVerificationRecord = {
        id: 'rec-1',
        userId,
        phone,
        tokenHash: 'hash',
        codeHash,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        failedAttempts: 0,
      };
      repo.findLatestActive.mockResolvedValueOnce(record);
      repo.consumeActive.mockResolvedValueOnce(false); // Lost race

      await expect(service.verifyOtp(userId, phone, plainCode)).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PHONE_OTP_ALREADY_USED' }),
        }),
      );
    });
  });
});
