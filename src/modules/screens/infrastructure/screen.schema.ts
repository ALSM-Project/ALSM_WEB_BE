import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ScreenSourceType, ScreenStatus } from '../domain/screen.types';

export type ScreenDocument = HydratedDocument<Screen>;

@Schema({ collection: 'screens', timestamps: true })
export class Screen {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true }) name!: string;
  @Prop({ enum: ScreenSourceType, required: true }) sourceType!: ScreenSourceType;
  @Prop({ enum: ScreenStatus, required: true }) status!: ScreenStatus;
  @Prop({ required: true }) inputReference!: string;
  @Prop() sizeBytes?: number;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ScreenSchema = SchemaFactory.createForClass(Screen);
ScreenSchema.index({ organizationId: 1, projectId: 1, createdAt: -1 });
