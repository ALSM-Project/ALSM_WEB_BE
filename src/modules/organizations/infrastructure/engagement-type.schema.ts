import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EngagementTypeDocument = HydratedDocument<EngagementType>;

@Schema({ collection: 'engagement_types', timestamps: true })
export class EngagementType {
  @Prop({ required: true, unique: true, trim: true }) name!: string;
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
  @Prop({ default: true }) isActive!: boolean;
}

export const EngagementTypeSchema = SchemaFactory.createForClass(EngagementType);
