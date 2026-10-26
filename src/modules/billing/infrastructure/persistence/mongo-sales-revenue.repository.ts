import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { requireActiveTransaction } from '../../../../shared/database/mongo-transaction-runner';
import {
  SalesPaymentResponsibility,
  SalesRevenueRepository,
  SalesRevenueRow,
} from '../../domain/sales-revenue.port';
import { PaymentStatus } from '../../domain/billing.types';
import { Payment } from '../payment.schema';

@Injectable()
export class MongoSalesRevenueRepository implements SalesRevenueRepository {
  constructor(@InjectModel(Payment.name) private readonly model: Model<Payment>) {}
  private session?: ClientSession;
  private transaction?: object;
  inTransaction(session: ClientSession, connection: Connection) {
    requireActiveTransaction(session);
    if (this.model.db !== connection) throw new Error('Payment transaction connection mismatch');
    const participant = new MongoSalesRevenueRepository(this.model);
    participant.session = session;
    participant.transaction = session.transaction;
    return participant;
  }
  private scope() {
    if (this.session) {
      requireActiveTransaction(this.session);
      if (this.transaction !== this.session.transaction)
        throw new Error('Stale payment transaction participant');
    }
    return this.session ?? null;
  }
  async record(input: SalesPaymentResponsibility) {
    if (!this.session)
      throw new Error('Payment attribution requires the audited atomic unit of work');
    const payment = await this.model
      .findOne({
        _id: new Types.ObjectId(input.paymentId),
        organizationId: new Types.ObjectId(input.organizationId),
      })
      .session(this.scope())
      .exec();
    const invalid = !payment
      ? ['PAYMENT_UNAVAILABLE']
      : [
          payment.status !== PaymentStatus.COMPLETED ? 'NOT_COMPLETED' : '',
          !(payment.paidAt instanceof Date) ? 'CONFIRMATION_DATE_REQUIRED' : '',
          !Number.isFinite(payment.paidAt?.getTime()) ? 'INVALID_CONFIRMATION_DATE' : '',
          Number(payment.paidAt?.getTime()) > Date.now() ? 'FUTURE_CONFIRMATION_DATE' : '',
          !Number.isSafeInteger(payment.amountVnd) || payment.amountVnd < 0
            ? 'INVALID_EXACT_VND_AMOUNT'
            : '',
        ].filter(Boolean);
    if (!payment || invalid.length)
      throw new BadRequestException({
        code: 'CONFIRMED_PAYMENT_REQUIRED',
        message:
          'A real completed payment with a valid confirmation date and exact VND amount in this organization is required',
        details: invalid,
      });
    if (payment.salesResponsibility) {
      const previous = payment.salesResponsibility;
      if (
        previous.teamId !== input.teamId ||
        previous.salespersonId !== input.salespersonId ||
        previous.actorUserId !== input.actorUserId ||
        previous.evidenceReference !== input.evidenceReference
      )
        throw new ConflictException({
          code: 'PAYMENT_SALESPERSON_CONFLICT',
          message: 'The confirmed transaction already has an immutable salesperson attribution',
        });
      return { ...previous, recordedAt: new Date(previous.recordedAt) };
    }
    if (
      payment.cassoTransactionId &&
      (await this.model
        .exists({
          organizationId: payment.organizationId,
          cassoTransactionId: payment.cassoTransactionId,
          _id: { $ne: payment._id },
        })
        .session(this.scope()))
    )
      throw new ConflictException({
        code: 'DUPLICATE_CONFIRMED_TRANSACTION',
        message: 'Billing transaction identity must be reconciled before assigning sales credit',
      });
    const updated = await this.model
      .findOneAndUpdate(
        {
          _id: payment._id,
          organizationId: payment.organizationId,
          salesResponsibility: { $exists: false },
        },
        { $set: { salesResponsibility: input } },
        { new: true },
      )
      .session(this.scope())
      .exec();
    if (!updated)
      throw new ConflictException('Payment responsibility changed; reload before another action');
    return input;
  }
  async read(
    organizationId: string,
    teamId: string,
    start: Date,
    end: Date,
  ): Promise<SalesRevenueRow[]> {
    const payments = await this.model
      .find({
        organizationId: new Types.ObjectId(organizationId),
        'salesResponsibility.teamId': teamId,
        status: PaymentStatus.COMPLETED,
        paidAt: { $gte: start, $lt: end },
      })
      .select('_id amountVnd cassoTransactionId salesResponsibility')
      .session(this.scope())
      .exec();
    const rows: SalesRevenueRow[] = [];
    for (const payment of payments) {
      if (!Number.isSafeInteger(payment.amountVnd) || payment.amountVnd < 0)
        throw new ConflictException({
          code: 'INVALID_CONFIRMED_REVENUE_SOURCE',
          message: 'Confirmed revenue has an invalid amount; reconcile billing source',
        });
      if (
        payment.cassoTransactionId &&
        (await this.model
          .exists({
            organizationId: new Types.ObjectId(organizationId),
            cassoTransactionId: payment.cassoTransactionId,
            _id: { $ne: payment._id },
          })
          .session(this.scope()))
      )
        throw new ConflictException({
          code: 'DUPLICATE_CONFIRMED_TRANSACTION',
          message:
            'Duplicate billing transaction identity; reporting cannot safely attribute this revenue',
        });
      rows.push({
        paymentId: String(payment._id),
        memberId: payment.salesResponsibility!.salespersonId,
        amountVnd: payment.amountVnd,
      });
    }
    return rows;
  }
}
