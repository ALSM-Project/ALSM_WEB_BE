import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

const AES_256_GCM_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_VERSION = 'v1';
const GCM_IV_LENGTH = 12;

@Injectable()
export class BankAccountEncryptionService {
  private readonly logger = new Logger(BankAccountEncryptionService.name);
  private readonly encryptionKey: Buffer;

  constructor(private readonly config: ConfigService) {
    this.encryptionKey = this.resolveKey();
  }

  /**
   * Encrypts plaintext bank account number using AES-256-GCM authenticated encryption.
   */
  encryptAccountNumber(plaintext: string): string {
    if (!plaintext) {
      throw new InternalServerErrorException('Account number cannot be empty for encryption');
    }
    try {
      const iv = randomBytes(GCM_IV_LENGTH);
      const cipher = createCipheriv(AES_256_GCM_ALGORITHM, this.encryptionKey, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext.trim(), 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return [
        ENCRYPTION_VERSION,
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        authTag.toString('base64url'),
      ].join('.');
    } catch (err) {
      this.logger.error('Failed to encrypt bank account number', err);
      throw new InternalServerErrorException({
        code: 'ENCRYPTION_FAILED',
        message: 'Failed to securely encrypt account number',
      });
    }
  }

  /**
   * Decrypts AES-256-GCM authenticated encrypted payload.
   */
  decryptAccountNumber(payload: string): string {
    if (!payload) {
      throw new InternalServerErrorException('Encrypted account number payload is missing');
    }
    try {
      const [version, ivEncoded, ciphertextEncoded, authTagEncoded, ...extra] = payload.split('.');
      if (
        version !== ENCRYPTION_VERSION ||
        !ivEncoded ||
        !ciphertextEncoded ||
        !authTagEncoded ||
        extra.length > 0
      ) {
        throw new Error('Invalid encrypted bank account format');
      }

      const iv = Buffer.from(ivEncoded, 'base64url');
      const ciphertext = Buffer.from(ciphertextEncoded, 'base64url');
      const authTag = Buffer.from(authTagEncoded, 'base64url');

      if (iv.length !== GCM_IV_LENGTH || !ciphertext.length || authTag.length !== 16) {
        throw new Error('Invalid encrypted bank account payload components');
      }

      const decipher = createDecipheriv(AES_256_GCM_ALGORITHM, this.encryptionKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (err) {
      this.logger.error('Failed to decrypt bank account number', err);
      throw new InternalServerErrorException({
        code: 'DECRYPTION_FAILED',
        message: 'Failed to securely decrypt account number',
      });
    }
  }

  /**
   * Creates a deterministic, irreversible HMAC-SHA256 hash for duplicate account detection.
   */
  hashAccountNumber(accountNumber: string): string {
    const normalized = accountNumber.replace(/\s+/g, '').trim();
    return createHmac('sha256', this.encryptionKey).update(normalized).digest('hex');
  }

  /**
   * Extracts the last 4 digits of an account number.
   */
  extractLast4(accountNumber: string): string {
    const cleaned = accountNumber.replace(/\s+/g, '').trim();
    return cleaned.length <= 4 ? cleaned : cleaned.slice(-4);
  }

  /**
   * Formats account number for safe display: "•••• •••• 1234"
   */
  formatMasked(last4: string): string {
    return `•••• •••• ${last4}`;
  }

  private resolveKey(): Buffer {
    const configuredKey = this.config.get<string>('BANK_ACCOUNT_ENCRYPTION_KEY');
    if (configuredKey) {
      try {
        const key = Buffer.from(configuredKey, 'base64');
        if (key.length === 32) return key;
      } catch {
        // fallback
      }
    }

    const mfaKey = this.config.get<string>('MFA_ENCRYPTION_KEY');
    if (mfaKey) {
      try {
        const key = Buffer.from(mfaKey, 'base64');
        if (key.length === 32) return key;
      } catch {
        // fallback
      }
    }

    // Deterministic fallback derived from JWT_SECRET or default seed for tests/dev
    const seed = this.config.get<string>('JWT_SECRET') || 'alsm-default-secret-salt-for-bank-accounts-dev-2026';
    return createHmac('sha256', 'bank-accounts-salt').update(seed).digest();
  }
}
