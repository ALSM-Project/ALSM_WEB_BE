import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BankConfigProps, IBankConfigRepository } from '../../domain/billing.repository.interface';
import { DEFAULT_BANK_CONFIG } from '../../domain/billing.types';
import { BankConfig, BankConfigDocument } from '../bank-config.schema';

@Injectable()
export class MongoBankConfigRepository implements IBankConfigRepository {
  constructor(
    @InjectModel(BankConfig.name)
    private readonly model: Model<BankConfigDocument>,
  ) {}

  private toDomain(doc: BankConfigDocument): BankConfigProps {
    return {
      id: doc._id.toString(),
      bankId: doc.bankId,
      bankName: doc.bankName,
      accountNumber: doc.accountNumber,
      accountName: doc.accountName,
      isActive: doc.isActive,
    };
  }

  async getActiveConfig(): Promise<BankConfigProps> {
    let doc = await this.model.findOne({ isActive: { $ne: false } }).exec();
    if (!doc) {
      doc = await this.model.create({
        ...DEFAULT_BANK_CONFIG,
        isActive: true,
      });
    }
    return this.toDomain(doc);
  }

  async seedDefaults(defaultConfig: BankConfigProps): Promise<void> {
    const count = await this.model.countDocuments().exec();
    if (count === 0) {
      await this.model.create({
        bankId: defaultConfig.bankId,
        bankName: defaultConfig.bankName,
        accountNumber: defaultConfig.accountNumber,
        accountName: defaultConfig.accountName,
        isActive: true,
      });
    } else {
      // Ensure STK 0899886249 is saved if previous document had old dummy account
      const existing = await this.model.findOne({ isActive: true }).exec();
      if (existing && existing.accountNumber !== defaultConfig.accountNumber) {
        existing.accountNumber = defaultConfig.accountNumber;
        existing.bankId = defaultConfig.bankId;
        existing.bankName = defaultConfig.bankName;
        existing.accountName = defaultConfig.accountName;
        await existing.save();
      }
    }
  }

  async updateConfig(props: Partial<BankConfigProps>): Promise<BankConfigProps> {
    const doc = await this.model
      .findOneAndUpdate(
        { isActive: true },
        { $set: props },
        { new: true, upsert: true },
      )
      .exec();
    return this.toDomain(doc);
  }
}
