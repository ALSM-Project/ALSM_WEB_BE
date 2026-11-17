import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as PDFDocModule from 'pdfkit';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { constants, existsSync, readFileSync } from 'node:fs';
import {
  buildContractDocumentData,
  FormattedDocumentData,
  numberToVietnameseWords,
} from './enterprise-contract-document.helper';

export { numberToVietnameseWords };

type PDFDocConstructor = typeof PDFDocModule;
const PDFDocument: PDFDocConstructor =
  (PDFDocModule as unknown as { default?: PDFDocConstructor }).default || PDFDocModule;

export interface RenderEnterpriseContractPdfOptions {
  contract: any;
  kind?: 'OFFICIAL_SIGNED' | 'CANONICAL_UNSIGNED' | 'REVIEW_COPY';
  locale?: 'vi' | 'en' | 'vi-en';
}

@Injectable()
export class EnterpriseContractPdfService {
  constructor(private readonly config: ConfigService) {}

  private async resolveFontPaths(): Promise<{ regular: string; bold: string; italic: string }> {
    const configuredRegular = this.config.get<string>('CONTRACT_PDF_FONT_PATH')?.trim();
    const configuredBold = this.config.get<string>('CONTRACT_PDF_FONT_BOLD_PATH')?.trim();
    const configuredItalic = this.config.get<string>('CONTRACT_PDF_FONT_ITALIC_PATH')?.trim();

    const candidateRegular = [
      configuredRegular,
      resolve('fonts/times.ttf'),
      resolve('ALSM_WEB_BE/fonts/times.ttf'),
      'C:\\Windows\\Fonts\\times.ttf',
    ].filter(Boolean) as string[];

    const candidateBold = [
      configuredBold,
      resolve('fonts/timesbd.ttf'),
      resolve('ALSM_WEB_BE/fonts/timesbd.ttf'),
      'C:\\Windows\\Fonts\\timesbd.ttf',
    ].filter(Boolean) as string[];

    const candidateItalic = [
      configuredItalic,
      resolve('fonts/timesi.ttf'),
      resolve('ALSM_WEB_BE/fonts/timesi.ttf'),
      'C:\\Windows\\Fonts\\timesi.ttf',
    ].filter(Boolean) as string[];

    let regular = '';
    for (const p of candidateRegular) {
      try {
        await access(p, constants.R_OK);
        regular = p;
        break;
      } catch {}
    }

    let bold = '';
    for (const p of candidateBold) {
      try {
        await access(p, constants.R_OK);
        bold = p;
        break;
      } catch {}
    }

    let italic = '';
    for (const p of candidateItalic) {
      try {
        await access(p, constants.R_OK);
        italic = p;
        break;
      } catch {}
    }

    if (!regular) {
      throw new ServiceUnavailableException({
        code: 'CONTRACT_PDF_FONT_UNAVAILABLE',
        message: 'Vietnamese Unicode TrueType font (Times New Roman) is not available on the server.',
      });
    }

    return {
      regular,
      bold: bold || regular,
      italic: italic || regular,
    };
  }

  /**
   * Main Render Method — Builds a complete, court-admissible
   * Enterprise Software Modernization Agreement formatted like a professional Word document.
   * Completely eliminates all dashboard tables, cards, and UI boxes.
   */
  async renderContractPdf(options: RenderEnterpriseContractPdfOptions): Promise<Buffer> {
    const fonts = await this.resolveFontPaths();
    const { contract } = options;

    const configDict = {
      PROVIDER_LEGAL_NAME: this.config.get<string>('PROVIDER_LEGAL_NAME'),
      PROVIDER_TAX_ID: this.config.get<string>('PROVIDER_TAX_ID'),
      PROVIDER_REGISTERED_ADDRESS: this.config.get<string>('PROVIDER_REGISTERED_ADDRESS'),
      PROVIDER_REPRESENTATIVE_NAME: this.config.get<string>('PROVIDER_REPRESENTATIVE_NAME'),
      PROVIDER_REPRESENTATIVE_TITLE: this.config.get<string>('PROVIDER_REPRESENTATIVE_TITLE'),
      PROVIDER_CONTACT_PHONE: this.config.get<string>('PROVIDER_CONTACT_PHONE'),
      PROVIDER_CONTACT_EMAIL: this.config.get<string>('PROVIDER_CONTACT_EMAIL'),
    };

    const docData: FormattedDocumentData = buildContractDocumentData(contract, configDict);

    const isSigned =
      options.kind === 'OFFICIAL_SIGNED' ||
      contract?.lifecycleStatus === 'COMPLETED' ||
      contract?.lifecycleStatus === 'CUSTOMER_SIGNED' ||
      contract?.signingProcess?.customerSigningStatus === 'SIGNED';

    const kind: 'OFFICIAL_SIGNED' | 'CANONICAL_UNSIGNED' | 'REVIEW_COPY' =
      options.kind || (isSigned ? 'OFFICIAL_SIGNED' : contract?.lifecycleStatus === 'DRAFT' ? 'REVIEW_COPY' : 'CANONICAL_UNSIGNED');

    const isDemoMode = Boolean(contract?.isDemoMode ?? (process.env.DEMO_MODE !== 'false'));

    // Initialize PDFKit
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 54, right: 54 },
      bufferPages: true,
      compress: true,
      info: {
        Title: `${docData.contractTitle} - ${docData.contractNumber}`,
        Author: docData.partyA.legalName,
        Subject: 'Hợp đồng dịch vụ thương mại B2B',
        Keywords: 'Hợp đồng, B2B, ALSM, Dịch vụ phần mềm, Ký điện tử',
        CreationDate: new Date(),
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));

    const streamPromise = new Promise<Buffer>((resolveBuf, rejectBuf) => {
      doc.once('end', () => resolveBuf(Buffer.concat(chunks)));
      doc.once('error', rejectBuf);
    });

    const primaryColor = '#000000';
    const secondaryColor = '#222222';
    const mutedColor = '#444444';

    // ─────────────────────────────────────────────────────────────────────────
    // 1. QUỐC HIỆU VÀ TIÊU NGỮ (CĂN GIỮA)
    // ─────────────────────────────────────────────────────────────────────────
    doc.font(fonts.bold).fontSize(12).fillColor(primaryColor).text(docData.nationalHeader.country, { align: 'center' });
    doc.moveDown(0.2);
    doc.font(fonts.bold).fontSize(11).fillColor(secondaryColor).text(docData.nationalHeader.motto, { align: 'center' });
    doc.moveDown(0.1);
    doc.font(fonts.regular).fontSize(10).fillColor(mutedColor).text('-----------------', { align: 'center' });
    doc.moveDown(0.8);

    // ─────────────────────────────────────────────────────────────────────────
    // 2. TÊN HỢP ĐỒNG & SỐ HIỆU
    // ─────────────────────────────────────────────────────────────────────────
    doc.font(fonts.bold).fontSize(14).fillColor(primaryColor).text(docData.contractTitle.toUpperCase(), { align: 'center', lineGap: 3 });
    doc.moveDown(0.3);
    doc.font(fonts.bold).fontSize(10).fillColor(secondaryColor).text(`Số: ${docData.contractNumber}`, { align: 'center' });
    doc.moveDown(0.2);
    doc.font(fonts.italic).fontSize(10).fillColor(secondaryColor).text(
      `Hôm nay, ${docData.effectiveDate.dateStr}, tại văn phòng ${docData.partyA.legalName}, các Bên tham gia ký kết hợp đồng gồm có:`,
      { align: 'center' },
    );
    doc.moveDown(0.8);

    // ─────────────────────────────────────────────────────────────────────────
    // 3. CĂN CỨ PHÁP LÝ (PREAMBLE)
    // ─────────────────────────────────────────────────────────────────────────
    doc.font(fonts.italic).fontSize(9.5).fillColor(secondaryColor).text(
      docData.preamble.join('\n'),
      { align: 'justify', lineGap: 2.5 },
    );
    doc.moveDown(0.8);

    // ─────────────────────────────────────────────────────────────────────────
    // 4. THÔNG TIN BÊN A (KHÔNG DÙNG BẢNG)
    // ─────────────────────────────────────────────────────────────────────────
    doc.font(fonts.bold).fontSize(11).fillColor(primaryColor).text(docData.partyA.roleHeader);
    doc.moveDown(0.2);
    const partyAText = [
      `Tên doanh nghiệp: ${docData.partyA.legalName}`,
      `Mã số doanh nghiệp / Mã số thuế: ${docData.partyA.taxId}`,
      `Địa chỉ trụ sở chính: ${docData.partyA.address}`,
      `Người đại diện theo pháp luật: ${docData.partyA.representativeName}`,
      `Chức vụ: ${docData.partyA.representativeTitle}`,
      `Điện thoại liên hệ: ${docData.partyA.phone}`,
      `Thư điện tử (Email): ${docData.partyA.email}`,
      `Tài khoản thanh toán: ${docData.partyA.bankAccount || '0899886249 mở tại Ngân hàng TMCP Quân Đội (MB Bank)'}`,
    ].join('\n');
    doc.font(fonts.regular).fontSize(10).fillColor(secondaryColor).text(partyAText, { lineGap: 2.5, indent: 15 });
    doc.moveDown(0.6);

    // ─────────────────────────────────────────────────────────────────────────
    // 5. THÔNG TIN BÊN B (KHÔNG DÙNG BẢNG)
    // ─────────────────────────────────────────────────────────────────────────
    doc.font(fonts.bold).fontSize(11).fillColor(primaryColor).text(docData.partyB.roleHeader);
    doc.moveDown(0.2);
    const partyBText = [
      `Tên doanh nghiệp: ${docData.partyB.legalName}`,
      `Mã số doanh nghiệp / Mã số thuế: ${docData.partyB.taxId}`,
      `Địa chỉ trụ sở: ${docData.partyB.address}`,
      `Người đại diện theo pháp luật: ${docData.partyB.representativeName}`,
      `Chức vụ: ${docData.partyB.representativeTitle}`,
      `Điện thoại liên hệ: ${docData.partyB.phone}`,
      `Thư điện tử (Email): ${docData.partyB.email}`,
    ].join('\n');
    doc.font(fonts.regular).fontSize(10).fillColor(secondaryColor).text(partyBText, { lineGap: 2.5, indent: 15 });
    doc.moveDown(0.6);

    doc.font(fonts.regular).fontSize(10).fillColor(primaryColor).text(
      'Hai Bên cùng thống nhất ký kết Hợp đồng Dịch vụ này với các điều khoản cụ thể sau đây:',
      { align: 'justify' },
    );
    doc.moveDown(0.8);

    // ─────────────────────────────────────────────────────────────────────────
    // 6. CÁC ĐIỀU KHOẢN HỢP ĐỒNG (ĐIỀU 1 ĐẾN ĐIỀU 10)
    // ─────────────────────────────────────────────────────────────────────────
    for (const article of docData.articles) {
      this.checkPageBreak(doc, 60);

      doc.font(fonts.bold).fontSize(11).fillColor(primaryColor).text(article.title, { paragraphGap: 3 });

      for (const item of article.items) {
        this.checkPageBreak(doc, 35);
        doc.font(fonts.regular).fontSize(10).fillColor(secondaryColor).text(
          `${item.clauseNumber}. ${item.text}`,
          { align: 'justify', lineGap: 2.5, paragraphGap: item.subItems ? 2 : 4 },
        );

        if (item.subItems && item.subItems.length > 0) {
          for (const sub of item.subItems) {
            this.checkPageBreak(doc, 25);
            doc.font(fonts.regular).fontSize(10).fillColor(secondaryColor).text(
              `${sub.key} ${sub.text}`,
              { align: 'justify', lineGap: 2.5, indent: 15, paragraphGap: 2 },
            );
          }
        }
      }

      doc.moveDown(0.4);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. PHẦN KÝ KẾT CUỐI HỢP ĐỒNG (2 CỘT VĂN BẢN ĐƠN GIẢN, KHÔNG BORDER, KHÔNG CARD)
    // ─────────────────────────────────────────────────────────────────────────
    this.checkPageBreak(doc, 170);
    doc.moveDown(0.6);
    doc.font(fonts.italic).fontSize(9.5).fillColor(secondaryColor).text(
      'Hợp đồng này được lập thành 02 bản điện tử có giá trị pháp lý như nhau. Mỗi Bên giữ 01 bản để thực hiện. ' +
      'Các Bên xác nhận đã đọc, hiểu rõ và hoàn toàn đồng ý với toàn bộ các điều khoản và ký tên dưới đây.',
      { align: 'justify', paragraphGap: 10 },
    );
    doc.moveDown(0.5);

    const sigStartY = doc.y;
    const colWidth = 230;
    const leftColX = 54;
    const rightColX = leftColX + colWidth + 27;

    // Bên A (Cột Trái)
    doc.font(fonts.bold).fontSize(10.5).fillColor(primaryColor).text(docData.signatures.partyA.title, leftColX, sigStartY, { width: colWidth, align: 'center' });
    doc.font(fonts.bold).fontSize(9.5).fillColor(secondaryColor).text(docData.signatures.partyA.roleTitle, leftColX, doc.y, { width: colWidth, align: 'center' });
    doc.moveDown(0.2);
    doc.font(fonts.regular).fontSize(9).fillColor(mutedColor).text(`Chức vụ: ${docData.signatures.partyA.signerTitle}`, leftColX, doc.y, { width: colWidth, align: 'center' });
    doc.moveDown(0.4);

    const getImgBuffer = (dataUrl?: string): Buffer | null => {
      if (!dataUrl) return null;
      try {
        const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches[2]) {
          return Buffer.from(matches[2], 'base64');
        }
        if (existsSync(dataUrl)) {
          return readFileSync(dataUrl);
        }
      } catch (e) {}
      return null;
    };

    if (docData.signatures.partyA.isSigned) {
      const sealBuf = getImgBuffer(docData.signatures.partyA.officialSealImage);
      const sigBuf = getImgBuffer(docData.signatures.partyA.signatureImage);

      if (sealBuf || sigBuf) {
        const imgY = doc.y + 4;
        if (docData.signatures.partyA.stampPosition === 'overlap') {
          if (sealBuf) {
            try {
              doc.image(sealBuf, leftColX + 35, imgY, { fit: [65, 65] });
            } catch (e) {}
          }
          if (sigBuf) {
            try {
              doc.image(sigBuf, leftColX + 70, imgY + 12, { fit: [95, 45] });
            } catch (e) {}
          }
        } else {
          if (sealBuf && sigBuf) {
            try {
              doc.image(sealBuf, leftColX + 25, imgY, { fit: [55, 55] });
            } catch (e) {}
            try {
              doc.image(sigBuf, leftColX + 90, imgY + 8, { fit: [95, 45] });
            } catch (e) {}
          } else if (sealBuf) {
            try {
              doc.image(sealBuf, leftColX + (colWidth - 60) / 2, imgY, { fit: [60, 60] });
            } catch (e) {}
          } else if (sigBuf) {
            try {
              doc.image(sigBuf, leftColX + (colWidth - 110) / 2, imgY, { fit: [110, 50] });
            } catch (e) {}
          }
        }
        doc.y = imgY + 68;
      } else {
        doc.moveDown(1.5);
        doc.font(fonts.bold).fontSize(9.5).fillColor('#15803d').text('[ĐÃ KÝ ĐIỆN TỬ BỞI BÊN A]', leftColX, doc.y, { width: colWidth, align: 'center' });
      }

      doc.moveDown(0.2);
      doc.font(fonts.italic).fontSize(8).fillColor('#15803d').text(
        `✓ Ký số: ${docData.signatures.partyA.certificateProvider || 'VNPT-CA'} (${docData.signatures.partyA.certificateReference || 'VNPT-ECA-ALSM-01'})`,
        leftColX,
        doc.y,
        { width: colWidth, align: 'center' },
      );
      doc.moveDown(0.15);
      doc.font(fonts.regular).fontSize(7.5).fillColor(mutedColor).text(
        `Thời gian: ${new Date(docData.signatures.partyA.signedAt || Date.now()).toLocaleString('vi-VN')}`,
        leftColX,
        doc.y,
        { width: colWidth, align: 'center' },
      );
      doc.moveDown(1.0);
    } else {
      doc.moveDown(3.5);
      doc.font(fonts.italic).fontSize(8.5).fillColor(mutedColor).text('(Ký, ghi rõ họ tên và đóng dấu)', leftColX, doc.y, { width: colWidth, align: 'center' });
      doc.moveDown(1.5);
    }
    doc.font(fonts.bold).fontSize(10).fillColor(primaryColor).text(docData.signatures.partyA.signerName, leftColX, doc.y, { width: colWidth, align: 'center' });

    // Bên B (Cột Phải)
    doc.font(fonts.bold).fontSize(10.5).fillColor(primaryColor).text(docData.signatures.partyB.title, rightColX, sigStartY, { width: colWidth, align: 'center' });
    doc.font(fonts.bold).fontSize(9.5).fillColor(secondaryColor).text(docData.signatures.partyB.roleTitle, rightColX, doc.y, { width: colWidth, align: 'center' });
    doc.moveDown(0.2);
    doc.font(fonts.regular).fontSize(9).fillColor(mutedColor).text(`Chức vụ: ${docData.signatures.partyB.signerTitle}`, rightColX, doc.y, { width: colWidth, align: 'center' });
    doc.moveDown(0.4);

    if (docData.signatures.partyB.isSigned) {
      doc.moveDown(1.5);
      doc.font(fonts.bold).fontSize(9.5).fillColor('#15803d').text('[ĐÃ KÝ ĐIỆN TỬ BỞI BÊN B]', rightColX, doc.y, { width: colWidth, align: 'center' });
      doc.moveDown(0.2);
      doc.font(fonts.italic).fontSize(8).fillColor(mutedColor).text(
        `Thời gian: ${new Date(docData.signatures.partyB.signedAt || Date.now()).toLocaleString('vi-VN')}`,
        rightColX,
        doc.y,
        { width: colWidth, align: 'center' },
      );
      doc.font(fonts.regular).fontSize(7.5).fillColor(mutedColor).text(
        `Chứng chỉ: ${docData.signatures.partyB.certificateReference || 'VNPT-ECA-CLIENT-VERIFIED'}`,
        rightColX,
        doc.y,
        { width: colWidth, align: 'center' },
      );
      doc.moveDown(1.5);
    } else {
      doc.moveDown(3.5);
      doc.font(fonts.italic).fontSize(8.5).fillColor(mutedColor).text('(Ký, ghi rõ họ tên và đóng dấu)', rightColX, doc.y, { width: colWidth, align: 'center' });
      doc.moveDown(1.5);
    }
    doc.font(fonts.bold).fontSize(10).fillColor(primaryColor).text(docData.signatures.partyB.signerName, rightColX, doc.y, { width: colWidth, align: 'center' });

    // ─────────────────────────────────────────────────────────────────────────
    // 8. HEADER & FOOTER ĐẦU/CUỐI TRANG (CHẠY 2-PASS)
    // ─────────────────────────────────────────────────────────────────────────
    const pageRange = doc.bufferedPageRange();
    const totalPages = pageRange.count;

    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);

      // Running Header
      doc.save();
      doc.font(fonts.bold).fontSize(7.5).fillColor('#475569').text(
        docData.partyA.legalName,
        54,
        25,
        { width: 330, align: 'left', lineBreak: false },
      );
      doc.font(fonts.regular).fontSize(7).fillColor('#64748b').text(
        `Hợp đồng: ${docData.contractNumber} (${docData.version})`,
        390,
        25,
        { width: 151, align: 'right', lineBreak: false },
      );
      doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(54, 36).lineTo(541, 36).stroke();

      // Running Footer
      doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(54, 792).lineTo(541, 792).stroke();
      doc.font(fonts.italic).fontSize(7).fillColor('#94a3b8').text(
        'Hợp đồng dịch vụ thương mại điện tử B2B  •  Lưu hành nội bộ giữa các Bên ký kết',
        54,
        798,
        { width: 330, align: 'left', lineBreak: false },
      );
      doc.font(fonts.bold).fontSize(7.5).fillColor('#475569').text(
        `Trang ${i + 1} / ${totalPages}`,
        390,
        798,
        { width: 151, align: 'right', lineBreak: false },
      );

      // Watermark indicator on draft
      if (kind === 'REVIEW_COPY') {
        doc.font(fonts.bold).fontSize(7.5).fillColor('#dc2626').text(
          'BẢN THẢO XEM XÉT NỘI BỘ — CHƯA CÓ HIỆU LỰC PHÁP LÝ',
          54,
          26,
          { width: 487, align: 'center', lineBreak: false },
        );
      } else if (kind === 'CANONICAL_UNSIGNED') {
        doc.font(fonts.bold).fontSize(7.5).fillColor('#d97706').text(
          'BẢN HỢP ĐỒNG ĐANG CHỜ CÁC BÊN HOÀN TẤT KÝ KẾT ĐIỆN TỬ',
          54,
          26,
          { width: 487, align: 'center', lineBreak: false },
        );
      }

      doc.restore();
    }

    doc.end();
    return streamPromise;
  }

  private checkPageBreak(doc: PDFKit.PDFDocument, requiredHeight: number) {
    if (doc.y + requiredHeight > 780) {
      doc.addPage();
    }
  }
}
