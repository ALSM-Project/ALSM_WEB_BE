import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as PDFDocumentModule from 'pdfkit';
import { ContractWithCurrentVersion } from '../domain/contract-aggregate.types';

const PDFDocument = (PDFDocumentModule as unknown as { default?: typeof PDFDocumentModule }).default || PDFDocumentModule;
const RENDERER_VERSION = 'alsm-contract-review-pdf-v1';

export interface EncryptedReviewPdf {
  bytes: Buffer;
  sha256: string;
  byteLength: number;
  encryptionKeyVersion: string;
  rendererVersion: string;
  fileName: string;
}

export interface EncryptedContractEvidenceArtifact {
  bytes: Buffer;
  sha256: string;
  byteLength: number;
  encryptionKeyVersion: string;
  fileName: string;
}

@Injectable()
export class ContractReviewDocumentService {
  constructor(private readonly config: ConfigService) {}

  async renderReviewCopy(value: ContractWithCurrentVersion): Promise<Buffer> {
    return this.renderPdf(value, 'REVIEW_COPY');
  }

  async renderCanonicalUnsigned(value: ContractWithCurrentVersion): Promise<Buffer> {
    return this.renderPdf(value, 'CANONICAL_UNSIGNED');
  }

  async renderDemoSignedPdf(value: ContractWithCurrentVersion, input: { signerName: string; signerEmail: string; signedAt: Date }): Promise<Buffer> {
    const fontPath = this.config.get<string>('CONTRACT_PDF_FONT_PATH')?.trim();
    if (!fontPath) throw new ServiceUnavailableException({ code: 'CONTRACT_PDF_FONT_NOT_CONFIGURED', message: 'Vietnamese PDF fonts are not configured.' });
    const resolvedFontPath = resolve(fontPath);
    try { await access(resolvedFontPath, constants.R_OK); }
    catch { throw new ServiceUnavailableException({ code: 'CONTRACT_PDF_FONT_UNAVAILABLE', message: 'The configured Vietnamese PDF font is unavailable.' }); }
    const configuredBoldPath = this.config.get<string>('CONTRACT_PDF_FONT_BOLD_PATH')?.trim();
    const boldFontPath = configuredBoldPath ? resolve(configuredBoldPath) : resolvedFontPath;
    try { await access(boldFontPath, constants.R_OK); }
    catch { throw new ServiceUnavailableException({ code: 'CONTRACT_PDF_BOLD_FONT_UNAVAILABLE', message: 'The configured contract PDF bold font is unavailable.' }); }

    const { contract, version } = value;
    const template = version.approvedTemplateSnapshot;
    if (!template || template.templateVersionId !== version.approvedTemplateVersionId) {
      throw new ConflictException({ code: 'CONTRACT_TEMPLATE_SNAPSHOT_REQUIRED', message: 'An approved immutable template snapshot is required for demo signing.' });
    }
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margins: { top: 68, bottom: 64, left: 58, right: 58 }, compress: true });
    doc.info = {
      Title: `DEMO simulated contract ${contract.contractNumber}`,
      Subject: 'DEMO ONLY. Simulated signing workflow; not a legally valid electronic signature.',
      Author: 'ALSM Technologies Corp.',
      CreationDate: new Date(input.signedAt),
      ModDate: new Date(input.signedAt),
    };
    doc.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    const completed = new Promise<Buffer>((resolvePdf, rejectPdf) => {
      doc.once('error', rejectPdf);
      doc.once('end', () => resolvePdf(Buffer.concat(chunks)));
    });
    const markDemo = () => {
      const y = doc.y;
      doc.save().font(boldFontPath).fontSize(9).fillColor('#b91c1c')
        .text('DEMO ONLY — NOT A LEGALLY VALID SIGNATURE', 58, 27, { width: 479, align: 'center', lineBreak: false })
        .restore();
      doc.y = y;
    };
    doc.on('pageAdded', markDemo);
    markDemo();
    doc.font(boldFontPath).fontSize(17).fillColor('#0b1f44').text('ALSM TECHNOLOGIES CORP.', { align: 'center' });
    doc.moveDown(0.4).font(boldFontPath).fontSize(14).fillColor('#111827').text('DEMO CONTRACT — SIMULATED SIGNING', { align: 'center' });
    doc.moveDown(0.7).font(resolvedFontPath).fontSize(9).fillColor('#991b1b')
      .text('This document demonstrates an application workflow only. No cryptographic signature, identity verification, or legally binding execution is provided.', { align: 'center' });
    doc.moveDown(0.8);
    doc.font(boldFontPath).fontSize(10).fillColor('#111827').text(`Contract: ${contract.contractNumber} · Version ${version.versionNumber}`);
    doc.font(resolvedFontPath).fontSize(9).text(`Original approved PDF SHA-256: ${version.canonicalDocument?.sha256 ?? 'unavailable'}`);
    doc.moveDown(0.6);
    doc.font(boldFontPath).fontSize(12).fillColor('#0b1f44').text(template.title);
    doc.font(resolvedFontPath).fontSize(8).fillColor('#64748b').text(`Approved template v${template.templateVersionNumber} · ${template.locale.toUpperCase()} · SHA-256 ${template.contentDigest}`);
    doc.moveDown(0.4);
    template.sections.forEach((section, index) => {
      doc.font(boldFontPath).fontSize(10).fillColor('#111827').text(`${index + 1}. ${section.heading}`, { paragraphGap: 3 });
      doc.font(resolvedFontPath).fontSize(9).fillColor('#1f2937').text(section.body, { align: 'justify', paragraphGap: 7, lineGap: 2 });
      doc.moveDown(0.25);
    });
    doc.addPage();
    doc.font(boldFontPath).fontSize(14).fillColor('#0b1f44').text('SIMULATED SIGNING RECORD', { align: 'center' });
    doc.moveDown(0.8).font(boldFontPath).fontSize(10).fillColor('#111827').text('ALSM Technologies Corp. (demo counter-signature)');
    doc.font(resolvedFontPath).fontSize(9).fillColor('#475569').text('Simulated as part of the graduation-project demonstration.');
    doc.moveDown(0.8).font(boldFontPath).fontSize(10).fillColor('#111827').text(`Customer: ${input.signerName}`);
    doc.font(resolvedFontPath).fontSize(9).fillColor('#475569').text(`Authenticated ALSM demo account: ${input.signerEmail}`);
    doc.text(`Customer confirmation time: ${input.signedAt.toISOString()}`);
    doc.moveDown(0.8).font(boldFontPath).fontSize(10).fillColor('#991b1b')
      .text('DEMO ONLY — ACCOUNT CONFIRMATION IS NOT REAL-WORLD IDENTITY PROOF OR AN ELECTRONIC SIGNATURE.', { align: 'center' });
    doc.end();
    return completed;
  }

  private async renderPdf(value: ContractWithCurrentVersion, kind: 'REVIEW_COPY' | 'CANONICAL_UNSIGNED'): Promise<Buffer> {
    const fontPath = this.config.get<string>('CONTRACT_PDF_FONT_PATH')?.trim();
    if (!fontPath) {
      throw new ServiceUnavailableException({ code: 'CONTRACT_PDF_FONT_NOT_CONFIGURED', message: 'Vietnamese PDF fonts are not configured.' });
    }
    const resolvedFontPath = resolve(fontPath);
    try {
      await access(resolvedFontPath, constants.R_OK);
    } catch {
      throw new ServiceUnavailableException({ code: 'CONTRACT_PDF_FONT_UNAVAILABLE', message: 'The configured Vietnamese PDF font is unavailable.' });
    }
    const configuredBoldPath = this.config.get<string>('CONTRACT_PDF_FONT_BOLD_PATH')?.trim();
    const boldFontPath = configuredBoldPath ? resolve(configuredBoldPath) : resolvedFontPath;
    try {
      await access(boldFontPath, constants.R_OK);
    } catch {
      throw new ServiceUnavailableException({ code: 'CONTRACT_PDF_BOLD_FONT_UNAVAILABLE', message: 'The configured contract PDF bold font is unavailable.' });
    }

    const { contract, version } = value;
    const template = version.approvedTemplateSnapshot;
    if (!template || template.templateVersionId !== version.approvedTemplateVersionId) {
      throw new ConflictException({ code: 'CONTRACT_TEMPLATE_SNAPSHOT_REQUIRED', message: 'An approved immutable template snapshot is required to create a review PDF.' });
    }
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 58, right: 58 }, compress: true });
    doc.info = {
      Title: `${kind === 'REVIEW_COPY' ? 'ALSM Contract Review Copy' : 'ALSM Contract for Signature'} ${contract.contractNumber}`,
      Subject: kind === 'REVIEW_COPY' ? 'Unissued contract review copy; not signature evidence' : 'Unsigned canonical contract version prepared for signing',
      Author: 'ALSM Technologies',
      CreationDate: new Date(version.createdAt),
      ModDate: new Date(version.updatedAt),
    };

    const addPageMarker = () => {
      const y = doc.y;
      doc.save();
      doc.font(boldFontPath).fontSize(9).fillColor('#9f1239')
        .text(
          kind === 'REVIEW_COPY' ? 'REVIEW COPY — NOT SIGNED — NOT FOR EXECUTION' : 'UNSIGNED CONTRACT — AWAITING REQUIRED SIGNATURES',
          58, 27, { width: 479, align: 'center', lineBreak: false },
        );
      doc.restore();
      doc.y = y;
    };
    doc.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));

    const completed = new Promise<Buffer>((resolvePdf, rejectPdf) => {
      doc.once('error', rejectPdf);
      doc.once('end', () => resolvePdf(Buffer.concat(chunks)));
    });

    doc.on('pageAdded', addPageMarker);
    addPageMarker();
    doc.font(boldFontPath).fontSize(18).fillColor('#0b1f44').text('ALSM TECHNOLOGIES CORP.', { align: 'center' });
    doc.moveDown(0.35);
    doc.font(boldFontPath).fontSize(15).fillColor('#111827').text(
      kind === 'REVIEW_COPY' ? 'CONTRACT REVIEW COPY' : 'CONTRACT FOR SIGNATURE',
      { align: 'center' },
    );
    doc.moveDown(0.8);

    doc.font(boldFontPath).fontSize(10).fillColor('#111827').text(`Contract number: ${contract.contractNumber}`);
    doc.font(resolvedFontPath).fontSize(10).text(`Contract version: ${version.versionNumber}   ·   Status: ${contract.lifecycleStatus.replace(/_/g, ' ')}`);
    doc.moveDown(0.6);

    this.writeField(doc, boldFontPath, resolvedFontPath, 'Contract title', version.title);
    this.writeField(doc, boldFontPath, resolvedFontPath, 'Provider', 'ALSM Technologies Corp.');
    this.writeField(doc, boldFontPath, resolvedFontPath, 'Customer organization', version.customerName);
    this.writeField(doc, boldFontPath, resolvedFontPath, 'Customer contact (authority not verified)', `${version.customerContactName} (${version.customerEmail})`);
    this.writeField(doc, boldFontPath, resolvedFontPath, 'Service plan', version.plan);
    this.writeField(doc, boldFontPath, resolvedFontPath, 'Annual value', `${new Intl.NumberFormat('vi-VN').format(version.annualValue)} ${version.currency}`);
    this.writeField(doc, boldFontPath, resolvedFontPath, 'Effective date in draft', version.effectiveDate);
    doc.moveDown(0.45);

    doc.font(boldFontPath).fontSize(12).fillColor('#0b1f44').text(template.title);
    doc.font(resolvedFontPath).fontSize(8).fillColor('#64748b')
      .text(`Approved template v${template.templateVersionNumber} · ${template.locale.toUpperCase()} · SHA-256 ${template.contentDigest}`);
    doc.moveDown(0.5);
    template.sections.forEach((section, index) => {
      doc.font(boldFontPath).fontSize(10.5).fillColor('#111827').text(`${index + 1}. ${section.heading}`, { paragraphGap: 3 });
      doc.font(resolvedFontPath).fontSize(10).fillColor('#1f2937').text(section.body, { align: 'justify', paragraphGap: 8, lineGap: 2 });
      doc.moveDown(0.3);
    });

    doc.moveDown(0.8);
    if (kind === 'REVIEW_COPY') {
      doc.font(boldFontPath).fontSize(10).fillColor('#9f1239').text('SIGNATURES NOT COLLECTED', { align: 'center' });
      doc.font(resolvedFontPath).fontSize(9).fillColor('#475569')
        .text('This file is generated for review only. No electronic signature, provider confirmation, or execution evidence is attached.', { align: 'center' });
    } else {
      doc.font(boldFontPath).fontSize(10).fillColor('#111827').text('SIGNATURES', { align: 'center' });
      doc.moveDown(0.7);
      doc.font(boldFontPath).fontSize(9).text('FOR ALSM TECHNOLOGIES CORP.');
      doc.font(resolvedFontPath).fontSize(8).fillColor('#475569').text('Authorized representative signature will be collected by the approved signing provider.');
      doc.moveDown(1.1);
      doc.font(boldFontPath).fontSize(9).fillColor('#111827').text(`FOR ${version.customerName.toLocaleUpperCase()}`);
      doc.font(resolvedFontPath).fontSize(8).fillColor('#475569')
        .text(`Intended signer: ${version.customerContactName} (${version.customerEmail}); signing authority has not been verified by this PDF.`);
      doc.moveDown(1.1);
      doc.font(boldFontPath).fontSize(9).fillColor('#9f1239').text('NO SIGNATURES HAVE BEEN COLLECTED', { align: 'center' });
    }
    doc.end();
    return completed;
  }

  encryptReviewCopy(plainBytes: Buffer, contractNumber: string): EncryptedReviewPdf {
    return this.encryptPdf(plainBytes, contractNumber, 'review-copy');
  }

  encryptCanonicalUnsigned(plainBytes: Buffer, contractNumber: string): EncryptedReviewPdf {
    return this.encryptPdf(plainBytes, contractNumber, 'unsigned-contract');
  }

  encryptEvidenceArtifact(plainBytes: Buffer, fileName: string): EncryptedContractEvidenceArtifact {
    const keyValue = this.config.get<string>('CONTRACT_EVIDENCE_ENCRYPTION_KEY')?.trim() ?? '';
    const key = Buffer.from(keyValue, 'base64');
    if (key.length !== 32 || key.toString('base64') !== keyValue) {
      throw new ServiceUnavailableException({ code: 'CONTRACT_EVIDENCE_ENCRYPTION_NOT_CONFIGURED', message: 'Private contract file encryption is not configured.' });
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
    const bytes = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    return {
      bytes,
      sha256: createHash('sha256').update(plainBytes).digest('hex'),
      byteLength: plainBytes.length,
      encryptionKeyVersion: 'v1',
      fileName: fileName.replace(/[^a-z\d._-]/gi, '_').slice(0, 180),
    };
  }

  private encryptPdf(plainBytes: Buffer, contractNumber: string, suffix: string): EncryptedReviewPdf {
    const keyValue = this.config.get<string>('CONTRACT_EVIDENCE_ENCRYPTION_KEY')?.trim() ?? '';
    const key = Buffer.from(keyValue, 'base64');
    if (key.length !== 32 || key.toString('base64') !== keyValue) {
      throw new ServiceUnavailableException({ code: 'CONTRACT_EVIDENCE_ENCRYPTION_NOT_CONFIGURED', message: 'Private contract file encryption is not configured.' });
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
    const bytes = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    const fileName = `contract-${contractNumber.replace(/[^a-zA-Z0-9-]/g, '-')}-${suffix}.pdf`;
    return {
      bytes,
      sha256: createHash('sha256').update(plainBytes).digest('hex'),
      byteLength: plainBytes.length,
      encryptionKeyVersion: 'v1',
      rendererVersion: RENDERER_VERSION,
      fileName,
    };
  }

  decryptReviewCopy(encryptedBytes: Buffer, expectedKeyVersion: string, expectedSha256: string): Buffer {
    return this.decryptEncryptedArtifact(encryptedBytes, expectedKeyVersion, expectedSha256);
  }

  decryptEncryptedArtifact(encryptedBytes: Buffer, expectedKeyVersion: string, expectedSha256: string): Buffer {
    const keyValue = this.config.get<string>('CONTRACT_EVIDENCE_ENCRYPTION_KEY')?.trim() ?? '';
    const key = Buffer.from(keyValue, 'base64');
    if (expectedKeyVersion !== 'v1' || key.length !== 32 || key.toString('base64') !== keyValue || encryptedBytes.length < 29) {
      throw new ServiceUnavailableException({ code: 'CONTRACT_EVIDENCE_KEY_UNAVAILABLE', message: 'The contract review file cannot be decrypted with the configured key.' });
    }
    try {
      const nonce = encryptedBytes.subarray(0, 12);
      const authTag = encryptedBytes.subarray(12, 28);
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(authTag);
      const plainBytes = Buffer.concat([decipher.update(encryptedBytes.subarray(28)), decipher.final()]);
      const digest = createHash('sha256').update(plainBytes).digest('hex');
      if (digest !== expectedSha256) throw new Error('checksum mismatch');
      return plainBytes;
    } catch {
      throw new ServiceUnavailableException({ code: 'CONTRACT_EVIDENCE_FILE_INTEGRITY_FAILURE', message: 'The stored contract evidence failed its integrity check.' });
    }
  }

  private writeField(doc: PDFKit.PDFDocument, boldFontPath: string, fontPath: string, label: string, value: string) {
    doc.font(boldFontPath).fontSize(9.5).fillColor('#334155').text(`${label}: `, { continued: true });
    doc.font(fontPath).fontSize(9.5).fillColor('#111827').text(value);
  }
}
