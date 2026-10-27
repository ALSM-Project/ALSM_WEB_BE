import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import PDFDocument from 'pdfkit';
import { AuditLog, AuditLogDocument } from '../../audit/infrastructure/audit-log.schema';

export interface AuditLogListQuery {
  page?: number;
  limit?: number;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
}

// UC 3.13.10 — View Audit Logs.
// Owns reading and exporting the immutable, append-only audit trail.
@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
  ) {}

  async list(query?: AuditLogListQuery) {
    const page = Math.max(1, query?.page || 1);
    const limit = Math.min(100, Math.max(1, query?.limit || 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<AuditLogDocument> = {};
    if (query?.action) filter.action = new RegExp(query.action, 'i');
    if (query?.resourceType) filter.resourceType = query.resourceType;
    if (query?.resourceId) filter.resourceId = query.resourceId;
    if (query?.actorUserId) filter.actorUserId = query.actorUserId;

    if (query?.from || query?.to) {
      filter.createdAt = {};
      if (query?.from) filter.createdAt.$gte = new Date(query.from);
      if (query?.to) filter.createdAt.$lte = new Date(query.to);
    }

    const [items, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .populate('actorUserId', 'fullName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.auditModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async exportCsv(): Promise<string> {
    const logs = await this.auditModel
      .find()
      .populate('actorUserId', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(1000)
      .exec();

    const headers = 'Timestamp,Actor,Action,ResourceType,ResourceId,Metadata\n';
    const rows = logs.map((l) => {
      const actor = l.actorUserId as unknown as { fullName?: string; email?: string } | undefined;
      const actorStr = actor?.fullName || actor?.email || String(l.actorUserId || 'SYSTEM');
      const metaStr = JSON.stringify(l.metadata || {}).replace(/"/g, '""');
      return `"${l.createdAt ? (l.createdAt as Date).toISOString() : ''}","${actorStr}","${l.action}","${l.resourceType}","${l.resourceId || ''}","${metaStr}"`;
    });

    return headers + rows.join('\n');
  }

  async exportPdf(): Promise<Buffer> {
    const logs = await this.auditModel
      .find()
      .populate('actorUserId', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(1000)
      .exec();

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 24 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(14).text('Audit Logs', { align: 'center' });
    doc.moveDown(0.5);

    const columns = ['Timestamp', 'Actor', 'Action', 'ResourceType', 'ResourceId', 'IP Address'];
    const colWidths = [120, 120, 140, 100, 100, 90];
    const startX = doc.page.margins.left;
    let y = doc.y;

    columns.forEach((col, i) => {
      const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
      doc.font('Helvetica-Bold').fontSize(8).text(col, x, y, { width: colWidths[i] });
    });
    doc.font('Helvetica').fontSize(7);
    y += 18;

    for (const l of logs) {
      const actor = l.actorUserId as unknown as { fullName?: string; email?: string } | undefined;
      const actorStr = actor?.fullName || actor?.email || String(l.actorUserId || 'SYSTEM');
      const row = [
        l.createdAt ? (l.createdAt as Date).toISOString() : '',
        actorStr,
        l.action,
        l.resourceType,
        l.resourceId || '',
        l.ipAddress || '',
      ];

      if (y > doc.page.height - 40) {
        doc.addPage();
        y = doc.y;
      }

      row.forEach((cell, i) => {
        const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(cell, x, y, { width: colWidths[i], height: 12, ellipsis: true });
      });
      y += 14;
    }

    doc.end();
    await new Promise<void>((resolve) => doc.on('end', () => resolve()));
    return Buffer.concat(chunks);
  }
}
