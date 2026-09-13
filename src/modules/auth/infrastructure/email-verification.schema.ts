import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type EmailVerificationDocument = HydratedDocument<EmailVerification>;

@Schema({ collection: 'email_verifications', timestamps: true })
export class EmailVerification {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  tokenHash!: string;

  @Prop({ required: true, index: true })
  code!: string;

  @Prop({ required: true, index: { expires: 0 } })
  expiresAt!: Date;

  @Prop()
  consumedAt?: Date;
}

export const EmailVerificationSchema = SchemaFactory.createForClass(EmailVerification);
