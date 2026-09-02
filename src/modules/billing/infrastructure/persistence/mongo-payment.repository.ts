import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  IPaymentRepository,
  PaymentProps,
} from '../../domain/billing.repository.interface';
import { PaymentStatus } from '../../domain/billing.types';
import { Payment, PaymentDocument } from '../payment.schema';
import { PaymentMapper } from '../mapper/billing.mapper';

@Injectable()
export class MongoPaymentRepository implements IPaymentRepository {
  constructor(
    @InjectModel(Payment.name)
    private readonly model: Model<PaymentDocument>,
  ) {}

  async findById(id: string): Promise<PaymentProps | null> {
    const doc = await this.model.findById(id).exec();
    return doc ? PaymentMapper.toDomain(doc) : null;
  }

  async findPending(): Promise<PaymentProps[]> {
    const docs = await this.model
      .find({
        status: PaymentStatus.PENDING,
        expiresAt: { $gt: new Date() },
      })
      .exec();

    return docs.map(PaymentMapper.toDomain);
  }

  async create(props: Omit<PaymentProps, 'id'>): Promise<PaymentProps> {
    const doc = await this.model.create({
      ...props,
      userId: new Types.ObjectId(props.userId),
      organizationId: new Types.ObjectId(props.organizationId),
      subscriptionId: props.subscriptionId ? new Types.ObjectId(props.subscriptionId) : undefined,
      invoiceId: props.invoiceId ? new Types.ObjectId(props.invoiceId) : undefined,
    });

    return PaymentMapper.toDomain(doc);
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    paidAt?: Date,
    cassoTxId?: string,
  ): Promise<PaymentProps | null> {
    const update: any = { status };
    if (paidAt) update.paidAt = paidAt;
    if (cassoTxId) update.cassoTransactionId = cassoTxId;

    const doc = await this.model
      .findByIdAndUpdate(id, update, { new: true })
      .exec();

    return doc ? PaymentMapper.toDomain(doc) : null;
  }
}
