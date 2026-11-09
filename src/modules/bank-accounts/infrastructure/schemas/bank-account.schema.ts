import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BankAccountDocument = BankAccount & Document;

@Schema({ timestamps: true, collection: 'bank_accounts' })
export class BankAccount {
  @Prop({ required: true, trim: true })
  bankName!: string;

  @Prop({ type: String, trim: true, uppercase: true, default: null })
  bankCode?: string | null;

  @Prop({ type: String, trim: true, default: null })
  bin?: string | null;

  @Prop({ required: true, trim: true })
  accountHolderName!: string;

  @Prop({ required: true })
  accountNumberEncrypted!: string;

  @Prop({ required: true, trim: true })
  accountNumberLast4!: string;

  @Prop({ required: true, index: true })
  accountNumberHash!: string;

  @Prop({ required: true, uppercase: true, trim: true, default: 'VND' })
  currency!: string;

  @Prop({ uppercase: true, trim: true, default: 'VN' })
  country!: string;

  @Prop({ type: String, trim: true, default: null })
  branchName?: string | null;

  @Prop({ type: String, trim: true, uppercase: true, default: null })
  swiftBic?: string | null;

  @Prop({ type: String, trim: true, default: null })
  bankAddress?: string | null;

  @Prop({ type: String, trim: true, default: null })
  description?: string | null;

  @Prop({ required: true, enum: ['active', 'inactive'], default: 'active', index: true })
  status!: string;

  @Prop({ required: true, default: false, index: true })
  isDefault!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy?: Types.ObjectId | string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | string | null;

  @Prop({ type: Date, default: null })
  deactivatedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deactivatedBy?: Types.ObjectId | string | null;

  @Prop({ type: String, trim: true, default: null })
  deactivationReason?: string | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);

// Compound indexes for fast querying and duplicate checks
BankAccountSchema.index({ currency: 1, isDefault: 1 });
BankAccountSchema.index({ bankName: 1, accountNumberHash: 1, currency: 1, country: 1 });
