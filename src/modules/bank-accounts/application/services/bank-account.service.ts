import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  BankAccount,
  BankAccountDocument,
} from '../../infrastructure/schemas/bank-account.schema';
import { BankAccountEncryptionService } from '../../infrastructure/bank-account-encryption.service';
import { AUDIT_REPOSITORY, AuditRepository } from '../../../audit/domain/audit.repository';
import { CreateBankAccountDto } from '../../presentation/dto/create-bank-account.dto';
import { UpdateBankAccountDto } from '../../presentation/dto/update-bank-account.dto';
import { QueryBankAccountsDto } from '../../presentation/dto/query-bank-accounts.dto';
import { toValidObjectId } from '../../../../shared/utils/object-id.util';

export interface BankAccountSanitized {
  id: string;
  bankName: string;
  bankCode: string | null;
  bin: string | null;
  accountHolderName: string;
  accountNumberMasked: string;
  accountNumberLast4: string;
  currency: string;
  country: string;
  branchName: string | null;
  swiftBic: string | null;
  bankAddress: string | null;
  description: string | null;
  status: string;
  isDefault: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  deactivatedAt?: Date | null;
  deactivationReason?: string | null;
}

export interface BankAccountsListResult {
  items: BankAccountSanitized[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: {
    total: number;
    active: number;
    inactive: number;
    defaultCount: number;
  };
}

@Injectable()
export class BankAccountService {
  private readonly logger = new Logger(BankAccountService.name);

  constructor(
    @InjectModel(BankAccount.name)
    private readonly bankAccountModel: Model<BankAccountDocument>,
    private readonly encryption: BankAccountEncryptionService,
    @Inject(AUDIT_REPOSITORY)
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Lists bank accounts with search, filters, pagination, and summary metrics.
   */
  async list(query: QueryBankAccountsDto): Promise<BankAccountsListResult> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<BankAccountDocument> = {};

    if (query.status && query.status !== 'all') {
      filter.status = query.status;
    }

    if (query.currency && query.currency.trim()) {
      filter.currency = query.currency.trim().toUpperCase();
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(term, 'i');
      filter.$or = [
        { bankName: regex },
        { accountHolderName: regex },
        { bankCode: regex },
        { bin: regex },
        { branchName: regex },
        { accountNumberLast4: regex },
      ];
    }

    const sortField = query.sortBy || 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [sortField]: sortDirection };

    const [docs, filteredTotal, totalAll, activeCount, inactiveCount, defaultCount] =
      await Promise.all([
        this.bankAccountModel.find(filter).sort(sort).skip(skip).limit(limit).exec(),
        this.bankAccountModel.countDocuments(filter).exec(),
        this.bankAccountModel.countDocuments({}).exec(),
        this.bankAccountModel.countDocuments({ status: 'active' }).exec(),
        this.bankAccountModel.countDocuments({ status: 'inactive' }).exec(),
        this.bankAccountModel.countDocuments({ isDefault: true, status: 'active' }).exec(),
      ]);

    const items = docs.map((doc) => this.sanitize(doc));

    return {
      items,
      pagination: {
        page,
        limit,
        total: filteredTotal,
        totalPages: Math.ceil(filteredTotal / limit) || 1,
      },
      summary: {
        total: totalAll,
        active: activeCount,
        inactive: inactiveCount,
        defaultCount,
      },
    };
  }

  /**
   * Retrieves single bank account detail (masked by default).
   */
  async getById(id: string): Promise<BankAccountSanitized> {
    const doc = await this.bankAccountModel.findById(toValidObjectId(id)).exec();
    if (!doc) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'Bank account not found',
      });
    }
    return this.sanitize(doc);
  }

  /**
   * Creates a new company receiving bank account.
   */
  async create(dto: CreateBankAccountDto, actorUserId?: string): Promise<BankAccountSanitized> {
    const bankName = dto.bankName.trim();
    const accountHolderName = dto.accountHolderName.trim().toUpperCase();
    const currency = dto.currency.trim().toUpperCase();
    const country = (dto.country || 'VN').trim().toUpperCase();
    const status = dto.status || 'active';
    const isDefault = Boolean(dto.isDefault);

    if (isDefault && status === 'inactive') {
      throw new BadRequestException({
        code: 'INVALID_DEFAULT_STATUS',
        message: 'An inactive account cannot be configured as the default receiving account',
      });
    }

    const accountNumberHash = this.encryption.hashAccountNumber(dto.accountNumber);
    const accountNumberLast4 = this.encryption.extractLast4(dto.accountNumber);
    const accountNumberEncrypted = this.encryption.encryptAccountNumber(dto.accountNumber);

    // Duplicate detection based on bank, accountNumberHash, currency, country
    const duplicate = await this.bankAccountModel
      .findOne({
        bankName: { $regex: new RegExp(`^${bankName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        accountNumberHash,
        currency,
        country,
      })
      .exec();

    if (duplicate) {
      throw new ConflictException({
        code: 'DUPLICATE_BANK_ACCOUNT',
        message: 'A receiving account with this account number and currency already exists for this bank',
      });
    }

    // Atomic default receiving account management per currency
    if (isDefault) {
      await this.bankAccountModel.updateMany(
        { currency, isDefault: true },
        { $set: { isDefault: false } },
      );
    }

    const created = await this.bankAccountModel.create({
      bankName,
      bankCode: dto.bankCode ? dto.bankCode.trim().toUpperCase() : null,
      bin: dto.bin ? dto.bin.trim() : null,
      accountHolderName,
      accountNumberEncrypted,
      accountNumberLast4,
      accountNumberHash,
      currency,
      country,
      branchName: dto.branchName ? dto.branchName.trim() : null,
      swiftBic: dto.swiftBic ? dto.swiftBic.trim().toUpperCase() : null,
      bankAddress: dto.bankAddress ? dto.bankAddress.trim() : null,
      description: dto.description ? dto.description.trim() : null,
      status,
      isDefault,
      createdBy: actorUserId ? toValidObjectId(actorUserId) : null,
      updatedBy: actorUserId ? toValidObjectId(actorUserId) : null,
    });

    await this.audit.append({
      actorUserId,
      action: 'BANK_ACCOUNT_CREATED',
      resourceType: 'BANK_ACCOUNT',
      resourceId: created.id,
      metadata: {
        bankName: created.bankName,
        currency: created.currency,
        accountNumberLast4: created.accountNumberLast4,
        isDefault: String(created.isDefault),
        status: created.status,
      },
    });

    return this.sanitize(created);
  }

  /**
   * Updates an existing bank account.
   */
  async update(
    id: string,
    dto: UpdateBankAccountDto,
    actorUserId?: string,
  ): Promise<BankAccountSanitized> {
    const doc = await this.bankAccountModel.findById(toValidObjectId(id)).exec();
    if (!doc) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'Bank account not found',
      });
    }

    const changedFields: string[] = [];

    if (dto.bankName !== undefined && dto.bankName.trim() !== doc.bankName) {
      doc.bankName = dto.bankName.trim();
      changedFields.push('bankName');
    }

    if (dto.bankCode !== undefined) {
      const code = dto.bankCode ? dto.bankCode.trim().toUpperCase() : null;
      if (code !== doc.bankCode) {
        doc.bankCode = code;
        changedFields.push('bankCode');
      }
    }

    if (dto.bin !== undefined) {
      const b = dto.bin ? dto.bin.trim() : null;
      if (b !== doc.bin) {
        doc.bin = b;
        changedFields.push('bin');
      }
    }

    if (
      dto.accountHolderName !== undefined &&
      dto.accountHolderName.trim().toUpperCase() !== doc.accountHolderName
    ) {
      doc.accountHolderName = dto.accountHolderName.trim().toUpperCase();
      changedFields.push('accountHolderName');
    }

    if (dto.currency !== undefined && dto.currency.trim().toUpperCase() !== doc.currency) {
      doc.currency = dto.currency.trim().toUpperCase();
      changedFields.push('currency');
    }

    if (dto.country !== undefined && dto.country.trim().toUpperCase() !== doc.country) {
      doc.country = dto.country.trim().toUpperCase();
      changedFields.push('country');
    }

    if (dto.branchName !== undefined) {
      const branch = dto.branchName ? dto.branchName.trim() : null;
      if (branch !== doc.branchName) {
        doc.branchName = branch;
        changedFields.push('branchName');
      }
    }

    if (dto.swiftBic !== undefined) {
      const swift = dto.swiftBic ? dto.swiftBic.trim().toUpperCase() : null;
      if (swift !== doc.swiftBic) {
        doc.swiftBic = swift;
        changedFields.push('swiftBic');
      }
    }

    if (dto.bankAddress !== undefined) {
      const addr = dto.bankAddress ? dto.bankAddress.trim() : null;
      if (addr !== doc.bankAddress) {
        doc.bankAddress = addr;
        changedFields.push('bankAddress');
      }
    }

    if (dto.description !== undefined) {
      const desc = dto.description ? dto.description.trim() : null;
      if (desc !== doc.description) {
        doc.description = desc;
        changedFields.push('description');
      }
    }

    // Account Number update
    if (dto.accountNumber && dto.accountNumber.trim()) {
      const newHash = this.encryption.hashAccountNumber(dto.accountNumber);
      if (newHash !== doc.accountNumberHash) {
        const dup = await this.bankAccountModel
          .findOne({
            _id: { $ne: doc._id },
            bankName: { $regex: new RegExp(`^${doc.bankName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            accountNumberHash: newHash,
            currency: doc.currency,
            country: doc.country,
          })
          .exec();

        if (dup) {
          throw new ConflictException({
            code: 'DUPLICATE_BANK_ACCOUNT',
            message: 'A receiving account with this account number and currency already exists for this bank',
          });
        }

        doc.accountNumberHash = newHash;
        doc.accountNumberLast4 = this.encryption.extractLast4(dto.accountNumber);
        doc.accountNumberEncrypted = this.encryption.encryptAccountNumber(dto.accountNumber);
        changedFields.push('accountNumber');
      }
    }

    // Status update
    if (dto.status !== undefined && dto.status !== doc.status) {
      if (dto.status === 'inactive' && (dto.isDefault || (dto.isDefault === undefined && doc.isDefault))) {
        if (dto.isDefault) {
          throw new BadRequestException({
            code: 'INVALID_DEFAULT_STATUS',
            message: 'An inactive account cannot be configured as the default receiving account',
          });
        }
        // Deactivating account clears its default status
        doc.isDefault = false;
        changedFields.push('isDefault');
      }
      doc.status = dto.status;
      changedFields.push('status');
      if (dto.status === 'inactive') {
        doc.deactivatedAt = new Date();
        doc.deactivatedBy = actorUserId ? toValidObjectId(actorUserId) : null;
      } else {
        doc.deactivatedAt = null;
        doc.deactivatedBy = null;
        doc.deactivationReason = null;
      }
    }

    // Default status update
    if (dto.isDefault !== undefined && dto.isDefault !== doc.isDefault) {
      if (dto.isDefault && doc.status === 'inactive') {
        throw new BadRequestException({
          code: 'INVALID_DEFAULT_STATUS',
          message: 'An inactive account cannot be configured as the default receiving account',
        });
      }
      if (dto.isDefault) {
        await this.bankAccountModel.updateMany(
          { _id: { $ne: doc._id }, currency: doc.currency, isDefault: true },
          { $set: { isDefault: false } },
        );
      }
      doc.isDefault = dto.isDefault;
      changedFields.push('isDefault');
    }

    if (changedFields.length > 0) {
      doc.updatedBy = actorUserId ? toValidObjectId(actorUserId) : null;
      await doc.save();

      await this.audit.append({
        actorUserId,
        action: 'BANK_ACCOUNT_UPDATED',
        resourceType: 'BANK_ACCOUNT',
        resourceId: doc.id,
        metadata: {
          bankName: doc.bankName,
          currency: doc.currency,
          changedFields: changedFields.join(','),
        },
      });
    }

    return this.sanitize(doc);
  }

  /**
   * Sets this bank account as the atomic default receiving account for its currency.
   */
  async setDefault(id: string, actorUserId?: string): Promise<BankAccountSanitized> {
    const doc = await this.bankAccountModel.findById(toValidObjectId(id)).exec();
    if (!doc) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'Bank account not found',
      });
    }

    if (doc.status !== 'active') {
      throw new BadRequestException({
        code: 'CANNOT_SET_INACTIVE_DEFAULT',
        message: 'An inactive bank account cannot be set as the default receiving account',
      });
    }

    // Atomically unset existing default for this currency
    await this.bankAccountModel.updateMany(
      { _id: { $ne: doc._id }, currency: doc.currency, isDefault: true },
      { $set: { isDefault: false } },
    );

    doc.isDefault = true;
    doc.updatedBy = actorUserId ? toValidObjectId(actorUserId) : null;
    await doc.save();

    await this.audit.append({
      actorUserId,
      action: 'BANK_ACCOUNT_DEFAULT_SET',
      resourceType: 'BANK_ACCOUNT',
      resourceId: doc.id,
      metadata: {
        bankName: doc.bankName,
        currency: doc.currency,
        accountNumberLast4: doc.accountNumberLast4,
      },
    });

    return this.sanitize(doc);
  }

  /**
   * Soft deactivates a receiving bank account.
   */
  async deactivate(
    id: string,
    reason?: string,
    actorUserId?: string,
  ): Promise<BankAccountSanitized> {
    const doc = await this.bankAccountModel.findById(toValidObjectId(id)).exec();
    if (!doc) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'Bank account not found',
      });
    }

    doc.status = 'inactive';
    doc.isDefault = false; // Business rule: inactive account cannot remain default
    doc.deactivatedAt = new Date();
    doc.deactivatedBy = actorUserId ? toValidObjectId(actorUserId) : null;
    doc.deactivationReason = reason ? reason.trim() : null;
    doc.updatedBy = actorUserId ? toValidObjectId(actorUserId) : null;

    await doc.save();

    await this.audit.append({
      actorUserId,
      action: 'BANK_ACCOUNT_DEACTIVATED',
      resourceType: 'BANK_ACCOUNT',
      resourceId: doc.id,
      metadata: {
        bankName: doc.bankName,
        currency: doc.currency,
        reason: reason || 'Not provided',
      },
    });

    return this.sanitize(doc);
  }

  /**
   * Reactivates an inactive bank account.
   */
  async reactivate(id: string, actorUserId?: string): Promise<BankAccountSanitized> {
    const doc = await this.bankAccountModel.findById(toValidObjectId(id)).exec();
    if (!doc) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'Bank account not found',
      });
    }

    doc.status = 'active';
    doc.deactivatedAt = null;
    doc.deactivatedBy = null;
    doc.deactivationReason = null;
    doc.updatedBy = actorUserId ? toValidObjectId(actorUserId) : null;

    await doc.save();

    await this.audit.append({
      actorUserId,
      action: 'BANK_ACCOUNT_REACTIVATED',
      resourceType: 'BANK_ACCOUNT',
      resourceId: doc.id,
      metadata: {
        bankName: doc.bankName,
        currency: doc.currency,
      },
    });

    return this.sanitize(doc);
  }

  /**
   * Explicitly reveals the plaintext account number with mandatory security auditing.
   * Access is guarded by 'bank_accounts.reveal_sensitive_data'.
   */
  async revealAccountNumber(
    id: string,
    actorUserId?: string,
  ): Promise<{ id: string; accountNumber: string }> {
    const doc = await this.bankAccountModel.findById(toValidObjectId(id)).exec();
    if (!doc) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'Bank account not found',
      });
    }

    const decrypted = this.encryption.decryptAccountNumber(doc.accountNumberEncrypted);

    await this.audit.append({
      actorUserId,
      action: 'BANK_ACCOUNT_REVEALED',
      resourceType: 'BANK_ACCOUNT',
      resourceId: doc.id,
      metadata: {
        bankName: doc.bankName,
        currency: doc.currency,
        accountNumberLast4: doc.accountNumberLast4,
      },
    });

    return {
      id: doc.id,
      accountNumber: decrypted,
    };
  }

  private sanitize(doc: BankAccountDocument): BankAccountSanitized {
    return {
      id: doc._id.toString(),
      bankName: doc.bankName,
      bankCode: doc.bankCode || null,
      bin: doc.bin || null,
      accountHolderName: doc.accountHolderName,
      accountNumberMasked: this.encryption.formatMasked(doc.accountNumberLast4),
      accountNumberLast4: doc.accountNumberLast4,
      currency: doc.currency,
      country: doc.country || 'VN',
      branchName: doc.branchName || null,
      swiftBic: doc.swiftBic || null,
      bankAddress: doc.bankAddress || null,
      description: doc.description || null,
      status: doc.status,
      isDefault: doc.isDefault,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      deactivatedAt: doc.deactivatedAt || null,
      deactivationReason: doc.deactivationReason || null,
    };
  }
}
