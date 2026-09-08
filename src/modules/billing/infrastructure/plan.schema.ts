import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { PlanTier } from '../domain/billing.types';

export type PlanDocument = Plan & Document;

@Schema({ timestamps: true, collection: 'plans' })
export class Plan {
  @Prop({ required: true, unique: true, enum: PlanTier })
  tier!: PlanTier;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true, default: 0 })
  monthlyPriceVnd!: number;

  @Prop({ required: true, default: 0 })
  annualPriceVnd!: number;

  @Prop({ required: true, default: false })
  isPopular!: boolean;

  @Prop({ default: 1 })
  maxProjects!: number;

  @Prop({ default: 10 })
  maxScreensPerMonth!: number;

  @Prop({ default: 5 })
  storageGb!: number;

  @Prop({ type: [String], default: [] })
  features!: string[];

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop({ default: true })
  isActive!: boolean;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);
