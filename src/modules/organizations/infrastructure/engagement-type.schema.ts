import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EngagementTypeDocument = HydratedDocument<EngagementType>;

@Schema({ collection: 'engagement_types', timestamps: true })
export class EngagementType {
  @Prop({ required: true, unique: true, trim: true }) name!: string;
  @Prop({ trim: true, lowercase: true, index: { unique: true, sparse: true } }) normalizedName?: string;
  @Prop({ trim: true, uppercase: true, index: { unique: true, sparse: true } }) code?: string;
  @Prop({ trim: true }) description?: string;
  @Prop({ required: true, default: 0 }) price!: number;
  @Prop({
    type: {
      maxScreens: { type: Number, default: 10 },
      maxPrograms: { type: Number, default: 5 },
      maxStorageGb: { type: Number, default: 2 },
    },
    default: () => ({ maxScreens: 10, maxPrograms: 5, maxStorageGb: 2 }),
  })
  trialLimits!: {
    maxScreens: number;
    maxPrograms: number;
    maxStorageGb: number;
  };

  @Prop({
    type: {
      maxScreens: { type: Number, default: 100 },
      maxPrograms: { type: Number, default: 50 },
      maxStorageGb: { type: Number, default: 20 },
    },
    default: () => ({ maxScreens: 100, maxPrograms: 50, maxStorageGb: 20 }),
  })
  usageLimits!: {
    maxScreens: number;
    maxPrograms: number;
    maxStorageGb: number;
  };

  @Prop({ default: false }) includesCobolConversion!: boolean;
  @Prop({ type: [String], default: [] }) features!: string[];
  @Prop({ trim: true, default: 'STANDARD' }) supportTier!: string;
  @Prop({ min: 1, max: 8760, default: 12 }) slaHours!: number;
  @Prop({ default: true }) isActive!: boolean;
  @Prop({ trim: true, unique: true, sparse: true, select: false }) provisioningRequestId?: string;
  @Prop({ select: false }) provisioningFingerprint?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export const EngagementTypeSchema = SchemaFactory.createForClass(EngagementType);
