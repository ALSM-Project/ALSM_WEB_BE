import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClientSession, Connection, mongo, Types } from 'mongoose';
import {
  DiagnosticReadQuery,
  DiagnosticReadTransaction,
  DiagnosticView,
} from '../application/diagnostic-read.port';
import { requireActiveTransaction } from './mongo-transaction-runner';

export function diagnosticMissing(): NotFoundException {
  return new NotFoundException({
    code: 'SUPPORT_RESOURCE_NOT_FOUND',
    message: 'Resource unavailable in this scope',
  });
}
export function diagnosticId(value: unknown): string {
  const id = String(value ?? '');
  if (!/^[a-f0-9]{24}$/.test(id)) throw diagnosticMissing();
  return id;
}
export function diagnosticReference(id: string): { $in: (string | Types.ObjectId)[] } {
  return { $in: [new Types.ObjectId(diagnosticId(id)), id] };
}
export function diagnosticOrganization(id: string, inherited = false): mongo.Document {
  const scoped = { organizationId: diagnosticReference(id) };
  return inherited ? { $or: [scoped, { organizationId: { $exists: false } }] } : scoped;
}
/** Infrastructure helper only. No writes, raw payload projection or arbitrary query input. */
export class MongoDiagnosticRead {
  private readonly session: ClientSession;
  private readonly transaction: object;
  constructor(
    handle: DiagnosticReadTransaction,
    private readonly connection: Connection,
  ) {
    this.session = handle.session as ClientSession;
    requireActiveTransaction(this.session);
    if (handle.connection !== connection)
      throw new Error('Diagnostic transaction connection mismatch');
    this.transaction = this.session.transaction;
  }
  async rows(
    collection: string,
    query: DiagnosticReadQuery,
    scope: mongo.Document,
    fields: string[],
  ): Promise<mongo.Document[]> {
    requireActiveTransaction(this.session);
    if (this.transaction !== this.session.transaction)
      throw new Error('Stale diagnostic participant');
    diagnosticId(query.organizationId);
    if (query.projectId) diagnosticId(query.projectId);
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 25 ||
      (query.id && query.afterId)
    )
      throw new BadRequestException({
        code: 'INVALID_SUPPORT_PAGE',
        message: 'Invalid bounded page',
      });
    const identity = query.id
      ? { _id: new Types.ObjectId(diagnosticId(query.id)) }
      : query.afterId
        ? { _id: { $gt: new Types.ObjectId(diagnosticId(query.afterId)) } }
        : {};
    return this.connection
      .collection(collection)
      .find(
        { $and: [scope, identity] },
        {
          session: this.session,
          projection: Object.fromEntries(['_id', ...fields].map((field) => [field, 1])),
          sort: { _id: 1 },
          limit: query.id ? 1 : query.limit + 1,
          maxTimeMS: 2000,
        },
      )
      .toArray();
  }
}
/** Explicit field construction, never raw object spreading. Text is limited to labels. */
export function diagnosticView(
  row: mongo.Document,
  categorical: Record<string, readonly string[]>,
  labels: string[] = [],
  numbers: string[] = [],
): DiagnosticView {
  const view: DiagnosticView = { id: diagnosticId(row._id) };
  for (const [key, allowed] of Object.entries(categorical))
    view[key] = typeof row[key] === 'string' && allowed.includes(row[key]) ? row[key] : 'UNKNOWN';
  for (const key of labels)
    view[key] =
      typeof row[key] === 'string' ? row[key].replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 120) : '';
  for (const key of numbers)
    view[key] =
      typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0 ? row[key] : null;
  for (const key of ['createdAt', 'updatedAt'])
    view[key] = row[key] instanceof Date && Number.isFinite(row[key].getTime()) ? row[key] : null;
  return view;
}
