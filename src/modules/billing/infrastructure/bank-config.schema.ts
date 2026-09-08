import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BankConfigDocument = BankConfig & Document;

@Schema({ timestamps: true, collection: 'bank_configs' })
export class BankConfig {
  @Prop({ required: true, default: 'MB' })
  bankId!: string;

  @Prop({ required: true, default: 'MBBank (Ngan hang Quan doi)' })
  bankName!: string;

  @Prop({ required: true, default: '0899886249' })
  accountNumber!: string;

  @Prop({ required: true, default: 'CONG TY COPHAN ALSM SOFTWARE' })
  accountName!: string;

  @Prop({ default: true })
  isActive!: boolean;
}

export const BankConfigSchema = SchemaFactory.createForClass(BankConfig);
