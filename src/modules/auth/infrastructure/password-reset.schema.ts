import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PasswordResetDocument = HydratedDocument<PasswordReset>;

@Schema({ collection: 'password_resets', timestamps: true })
export class PasswordReset {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ required: true, index: true }) tokenHash!: string;
  @Prop({ required: true, index: { expires: 0 } }) expiresAt!: Date;
  @Prop() consumedAt?: Date;
}

export const PasswordResetSchema = SchemaFactory.createForClass(PasswordReset);
