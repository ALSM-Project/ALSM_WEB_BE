import { Injectable, Optional } from '@nestjs/common';
import { ValidationSecretRedactorService } from './validation-secret-redactor.service';

export interface SanitizedFileResult {
  path: string;
  sanitizedContent: string;
  lineCount: number;
  numberedContent: string;
}

/**
 * BƯỚC 4: Tầng Bảo Mật & Tiền Xử Lý (Data Sanitization & Pre-processing)
 * - PII Masking: Làm mờ dữ liệu định danh nhạy cảm trong INITIAL text (số thẻ, email, số điện thoại, CCCD)
 * - Secret Redaction: Che giấu API Key, Private Key, Bearer Token, Database Credentials, Password
 * - Code Stripping: Loại bỏ các comment rác và khoảng trắng dư thừa
 * - Line Numbering: Đánh số dòng tiền tố 1-based để LLM trích xuất tọa độ dòng chính xác
 */
@Injectable()
export class BmsSanitizerService {
  constructor(
    @Optional()
    private readonly secretRedactor: ValidationSecretRedactorService = new ValidationSecretRedactorService(),
  ) {}
  // Regex nhận diện các mẫu nhạy cảm phổ biến trong dữ liệu ban đầu của màn hình
  private readonly CREDIT_CARD_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;
  private readonly EMAIL_REGEX = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g;
  private readonly PHONE_REGEX = /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
  private readonly SSN_OR_ID_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

  /**
   * Khử thông tin nhạy cảm (PII) trong chuỗi văn bản hoặc code
   */
  maskPii(rawContent: string): string {
    return rawContent
      .replace(this.CREDIT_CARD_REGEX, '***CARD_MASKED***')
      .replace(this.EMAIL_REGEX, '***EMAIL_MASKED***')
      .replace(this.PHONE_REGEX, '***PHONE_MASKED***')
      .replace(this.SSN_OR_ID_REGEX, '***ID_MASKED***');
  }

  /**
   * Làm sạch mã nguồn BMS: bỏ comment rác (dòng bắt đầu bằng *) nhưng giữ lại số dòng tương ứng
   */
  stripBmsComments(bmsContent: string): string {
    const lines = bmsContent.split('\n');
    const cleaned = lines.map((line) => {
      const trimmed = line.trim();
      // Giữ lại dòng trống để không làm lệch số dòng thực tế
      if (trimmed.startsWith('*') && !trimmed.includes('DFHM')) {
        return '';
      }
      return line;
    });
    return cleaned.join('\n');
  }

  /**
   * Chuẩn hóa và đánh số dòng rõ ràng: "1: ...\n2: ..." để phục vụ Prompt của AI
   */
  formatWithLineNumbers(content: string): string {
    const lines = content.split('\n');
    return lines.map((line, idx) => `${idx + 1}: ${line}`).join('\n');
  }

  /**
   * Tiền xử lý hoàn chỉnh một file code đầu vào trước khi chuyển sang LLM
   */
  process(path: string, rawContent: string): SanitizedFileResult {
    const isBms = /\.(bms|dspf)$/i.test(path);
    let content = isBms ? this.stripBmsComments(rawContent) : rawContent;
    content = this.maskPii(content);
    content = this.secretRedactor.redact(content).content;

    const lines = content.split('\n');
    const numbered = this.formatWithLineNumbers(content);

    return {
      path,
      sanitizedContent: content,
      lineCount: lines.length,
      numberedContent: numbered,
    };
  }
}
