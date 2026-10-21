import { ValidationFindingSeverity } from './validation-finding.types';

/**
 * BƯỚC 1: Scoping & Error Taxonomy cho bài toán BMS/DSPF -> React TypeScript
 */
export enum BmsValidationCategory {
  /** Trường (label hoặc input) có ở BMS/DSPF nhưng biến mất ở code React */
  MISSING_FIELD = 'MISSING_FIELD',
  /** Sai khác thuộc tính nghiệp vụ (NUM -> numeric, DRK -> password, LENGTH -> maxLength, PROT -> readOnly/disabled) */
  ATTRIBUTE_MISMATCH = 'ATTRIBUTE_MISMATCH',
  /** Tọa độ hiển thị (gridRow, gridColumn, span) bị lệch hoặc đảo lộn so với POS=(row,col) của BMS */
  LAYOUT_DISCREPANCY = 'LAYOUT_DISCREPANCY',
  /** Thiếu hoặc gán sai phím chức năng (F3, F7, F8, Enter) so với BMS function keys */
  PF_KEY_MISMATCH = 'PF_KEY_MISMATCH',
  /** Sai lệch giá trị mặc định INITIAL, định dạng PICOUT/PICIN, hoặc logic thông báo lỗi (ERRMSG/INFOMSG) */
  SEMANTIC_LOGIC = 'SEMANTIC_LOGIC',
}

/**
 * BƯỚC 2: Output Contract (Cấu trúc đối tượng lỗi chuẩn JSON)
 */
export interface BmsCodeLocation {
  file: string;
  startLine: number;
  endLine: number;
  snippet?: string;
}

export interface BmsValidationFinding {
  findingId?: string;
  category: BmsValidationCategory;
  severity: ValidationFindingSeverity;
  fieldName: string;
  sourceLocation: BmsCodeLocation;
  targetLocation: BmsCodeLocation;
  explanation: string;
  suggestion: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  confidence?: number;
}

export interface BmsValidationOutputContract {
  screenName: string;
  validationTimestamp: string;
  validatorVersion: string;
  findings: BmsValidationFinding[];
  summary: {
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
  };
}

/**
 * JSON Schema chuẩn để ép buộc LLM (Gemini/OpenAI) trả lời theo khuôn mẫu có cấu trúc
 */
export const BMS_VALIDATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: Object.values(BmsValidationCategory),
            description: 'Mã danh mục lỗi (MISSING_FIELD, ATTRIBUTE_MISMATCH, LAYOUT_DISCREPANCY, PF_KEY_MISMATCH, SEMANTIC_LOGIC)',
          },
          severity: {
            type: 'string',
            enum: Object.values(ValidationFindingSeverity),
            description: 'Mức độ nghiêm trọng của lỗi (CRITICAL, HIGH, MEDIUM, LOW)',
          },
          fieldName: {
            type: 'string',
            description: 'Tên trường hoặc thành phần gây lỗi (ví dụ: CARDSID, CRDNAME, FKEYS)',
          },
          sourceLocation: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              startLine: { type: 'integer' },
              endLine: { type: 'integer' },
              snippet: { type: 'string' },
            },
            required: ['file', 'startLine', 'endLine'],
          },
          targetLocation: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              startLine: { type: 'integer' },
              endLine: { type: 'integer' },
              snippet: { type: 'string' },
            },
            required: ['file', 'startLine', 'endLine'],
          },
          explanation: {
            type: 'string',
            description: 'Mô tả ngắn gọn, chính xác bằng ngôn ngữ tự nhiên lý do sai khác',
          },
          suggestion: {
            type: 'string',
            description: 'Đề xuất cụ thể dòng code cần sửa ở phía React',
          },
        },
        required: [
          'category',
          'severity',
          'fieldName',
          'sourceLocation',
          'targetLocation',
          'explanation',
          'suggestion',
        ],
      },
    },
  },
  required: ['findings'],
};
