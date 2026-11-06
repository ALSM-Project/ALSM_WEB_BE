import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ collection: 'phone_verifications', timestamps: true })
export class PhoneVerification {
  /** User requesting verification. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  /**
   * E.164 phone number.  Indexed together with userId for per-user lookups
   * and rate-limit counting.
   */
  @Prop({ required: true })
  phone!: string;

  /** SHA-256 hex digest of the raw 32-byte token. */
  @Prop({ required: true, index: true })
  tokenHash!: string;

  /** Bcrypt hash of the 6-digit OTP code. */
  @Prop({ required: true })
  codeHash!: string;

  /** TTL-indexed: MongoDB automatically removes expired documents. */
  @Prop({ required: true, index: { expires: 0 } })
  expiresAt!: Date;

  /** Set once when the OTP is successfully consumed. */
  @Prop()
  consumedAt?: Date;

  /** Tracks brute-force attempts — lockout after a threshold. */
  @Prop({ required: true, default: 0 })
  failedAttempts!: number;

  /* Mongoose timestamps */
  createdAt!: Date;
  updatedAt!: Date;
}

export type PhoneVerificationDocument = HydratedDocument<PhoneVerification>;
export const PhoneVerificationSchema = SchemaFactory.createForClass(PhoneVerification);

/* Compound index for rate-limit queries: "how many OTPs for this user+phone recently?" */
PhoneVerificationSchema.index({ userId: 1, phone: 1, createdAt: -1 });

