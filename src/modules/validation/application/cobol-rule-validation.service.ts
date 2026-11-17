import { Injectable, Logger } from '@nestjs/common';
import {
  AiValidationFindingDraft,
  AiValidationInput,
} from '../domain/ai-validator.port';
import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
} from '../domain/validation-finding.types';

export interface CobolRawVariable {
  name: string;
  normalizedName: string;
  level: number;
  picClause?: string;
  isNumeric: boolean;
  isDecimalOrCurrency: boolean;
  isPackedDecimal: boolean;
  isString: boolean;
  rawStatement: string;
  line: number;
}

export interface CobolRawParagraph {
  name: string;
  normalizedName: string;
  hasSql: boolean;
  hasFileIo: boolean;
  line: number;
}

export interface JavaRawField {
  name: string;
  normalizedName: string;
  type: string;
  rawStatement: string;
  line: number;
}

export interface JavaRawMethod {
  name: string;
  normalizedName: string;
  returnType: string;
  line: number;
}

export interface CobolRuleValidationResult {
  findings: AiValidationFindingDraft[];
  summary: {
    cobolVariablesCount: number;
    cobolParagraphsCount: number;
    javaFieldsCount: number;
    javaMethodsCount: number;
  };
}

/**
 * KIẾN TRÚC HYBRID CHO COBOL -> JAVA: BƯỚC 1 & 2 - DETERMINISTIC RULE ENGINE
 * - Tốc độ: < 5ms
 * - Zero Hallucination
 * - Tự động đối chiếu các quy tắc kỹ thuật cơ bản giữa COBOL và Java:
 *   1. DATA_TYPE_MISMATCH: Tiền tệ/COMP-3 trong COBOL nhưng dùng float/double/String trong Java thay vì BigDecimal.
 *   2. VARIABLE_MAPPING_MISMATCH: Biến nghiệp vụ chính của COBOL bị bỏ rơi trong Java.
 *   3. MISSING_OPERATION: Paragraph/Section nghiệp vụ trong PROCEDURE DIVISION không có method Java tương ứng.
 *   4. DATABASE_MISMATCH: COBOL có EXEC SQL nhưng Java không có xử lý DB/Repository.
 *   5. FILE_IO_MISMATCH: COBOL có thao tác File I/O (READ/WRITE) nhưng Java không xử lý I/O.
 */
@Injectable()
export class CobolRuleValidationService {
  private readonly logger = new Logger(CobolRuleValidationService.name);

  /**
   * Chuẩn hóa tên biến/hàm (bỏ tiền tố WS-, OUT-, IN-, dấu gạch ngang sang camelCase)
   */
  normalizeIdentifier(rawName: string): string {
    return rawName
      .toUpperCase()
      .replace(/^(WS|OUT|IN|FD|ARR|TEMP|REC)[-_]/, '')
      .replace(/^\d+[-_]/, '')
      .replace(/[-_]/g, '');
  }

  /**
   * Bóc tách thông tin từ mã nguồn COBOL
   */
  parseCobol(content: string): {
    variables: CobolRawVariable[];
    paragraphs: CobolRawParagraph[];
    hasExecSql: boolean;
    hasFileIo: boolean;
  } {
    const lines = content.split(/\r?\n/);
    const variables: CobolRawVariable[] = [];
    const paragraphs: CobolRawParagraph[] = [];
    let hasExecSql = false;
    let hasFileIo = false;

    let inDataDivision = false;
    let inProcedureDivision = false;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const rawLine = lines[i];

      // Bỏ qua dòng comment của COBOL (cột 7 có dấu * hoặc /)
      if (rawLine.length >= 7 && (rawLine[6] === '*' || rawLine[6] === '/')) {
        continue;
      }

      // Cắt bỏ 6 ký tự số thứ tự dòng ở cột đầu tiên của COBOL standard format nếu có
      let line = rawLine;
      if (/^\d{6}/.test(line)) {
        line = line.substring(6);
      }
      line = line.trim();

      if (/DATA\s+DIVISION/i.test(line)) {
        inDataDivision = true;
        inProcedureDivision = false;
        continue;
      }

      if (/PROCEDURE\s+DIVISION/i.test(line)) {
        inDataDivision = false;
        inProcedureDivision = true;
        continue;
      }

      if (/EXEC\s+SQL/i.test(line)) {
        hasExecSql = true;
      }

      if (/\b(READ|WRITE|REWRITE|OPEN|CLOSE)\s+[A-Za-z0-9_-]+/i.test(line)) {
        hasFileIo = true;
      }

      // 1. Phân tích biến trong DATA DIVISION
      if (inDataDivision) {
        const varMatch = line.match(/^(\d{2})\s+([A-Za-z0-9_-]+)(.*)/i);
        if (varMatch) {
          const level = parseInt(varMatch[1], 10);
          const varName = varMatch[2];
          const rest = varMatch[3];

          // Bỏ qua FILLER
          if (varName.toUpperCase() !== 'FILLER') {
            const picMatch = rest.match(/PIC(?:TURE)?(?:\s+IS)?\s+([A-Za-z0-9()$V,.\-+]+)/i);
            const picClause = picMatch ? picMatch[1].toUpperCase().replace(/\.+$/, '') : undefined;
            const hasComp3 = /COMP-3|PACKED-DECIMAL/i.test(rest);
            const isDecimalOrCurrency =
              hasComp3 || (picClause !== undefined && (picClause.includes('V') || /\d\.\d/.test(picClause)));
            const isNumeric = isDecimalOrCurrency || (picClause !== undefined && /^S?9/.test(picClause));
            const isString = picClause !== undefined && (picClause.includes('X') || picClause.includes('A'));

            variables.push({
              name: varName,
              normalizedName: this.normalizeIdentifier(varName),
              level,
              picClause,
              isNumeric,
              isDecimalOrCurrency,
              isPackedDecimal: hasComp3,
              isString,
              rawStatement: line,
              line: lineNum,
            });
          }
        }
      }

      // 2. Phân tích Paragraph / Section trong PROCEDURE DIVISION
      if (inProcedureDivision) {
        // Một Paragraph thường bắt đầu ở đầu dòng và kết thúc bằng dấu chấm: vd "1000-PROCESS-DATA."
        const paraMatch = line.match(/^([A-Za-z0-9][A-Za-z0-9_-]+)\s*\.\s*$/);
        if (paraMatch) {
          const paraName = paraMatch[1];
          if (!/^(IF|ELSE|END-IF|PERFORM|MOVE|EVALUATE|WHEN|COMPUTE|READ|WRITE|DISPLAY|EXIT|GOBACK|STOP|CALL)/i.test(paraName)) {
            paragraphs.push({
              name: paraName,
              normalizedName: this.normalizeIdentifier(paraName),
              hasSql: /EXEC\s+SQL/i.test(line),
              hasFileIo: /\b(READ|WRITE|REWRITE)\b/i.test(line),
              line: lineNum,
            });
          }
        }
      }
    }

    return { variables, paragraphs, hasExecSql, hasFileIo };
  }

  /**
   * Bóc tách thông tin từ mã nguồn Java
   */
  parseJava(content: string): {
    fields: JavaRawField[];
    methods: JavaRawMethod[];
    hasDatabaseOps: boolean;
    hasFileIoOps: boolean;
  } {
    const lines = content.split(/\r?\n/);
    const fields: JavaRawField[] = [];
    const methods: JavaRawMethod[] = [];

    const hasDatabaseOps =
      /@Query|@Repository|EntityManager|JdbcTemplate|Repository|\.save\(|\.findById\(|SELECT\s+|INSERT\s+INTO/i.test(
        content,
      );
    const hasFileIoOps =
      /File|FileReader|BufferedReader|FileWriter|Files\.|FileOutputStream|FileInputStream/i.test(
        content,
      );

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const trimmed = lines[i].trim();

      // Bỏ qua comment
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      // 1. Phân tích fields: private BigDecimal wsAmount; or public String name;
      const fieldMatch = trimmed.match(
        /(?:private|protected|public)?\s+(?:static\s+)?(?:final\s+)?([A-Za-z0-9_<>]+)\s+([A-Za-z0-9_]+)\s*(?:=|;)/,
      );
      if (fieldMatch) {
        const type = fieldMatch[1];
        const name = fieldMatch[2];
        if (!/^(class|interface|enum|return|if|else|throw)$/.test(type)) {
          fields.push({
            name,
            normalizedName: this.normalizeIdentifier(name),
            type,
            rawStatement: trimmed,
            line: lineNum,
          });
        }
      }

      // 2. Phân tích methods: public void processData(...) or public BigDecimal calculate()
      const methodMatch = trimmed.match(
        /(?:public|protected|private)?\s+(?:static\s+)?([A-Za-z0-9_<>]+)\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?:throws\s+[A-Za-z0-9_,\s]+)?\s*\{?/,
      );
      if (methodMatch) {
        const returnType = methodMatch[1];
        const methodName = methodMatch[2];
        if (!/^(if|for|while|switch|catch)$/.test(methodName) && !/^(class|interface|new)$/.test(returnType)) {
          methods.push({
            name: methodName,
            normalizedName: this.normalizeIdentifier(methodName),
            returnType,
            line: lineNum,
          });
        }
      }
    }

    return { fields, methods, hasDatabaseOps, hasFileIoOps };
  }

  /**
   * Chạy đối chiếu các quy tắc xác thực cơ học (Deterministic Rules)
   */
  validate(
    sourceFile: { path: string; content: string },
    targetFile: { path: string; content: string },
  ): CobolRuleValidationResult {
    const findings: AiValidationFindingDraft[] = [];

    const cobol = this.parseCobol(sourceFile.content);
    const java = this.parseJava(targetFile.content);

    // 1. QUY TẮC: DATA_TYPE_MISMATCH & VARIABLE_MAPPING_MISMATCH
    for (const cobVar of cobol.variables) {
      // Chỉ kiểm tra các biến có PIC clause và không phải biến phụ tá (FILLER)
      if (!cobVar.picClause) continue;

      // Tìm trường Java tương ứng bằng normalizedName
      const matchingField = java.fields.find(
        (jf) => jf.normalizedName === cobVar.normalizedName || jf.name.toLowerCase() === cobVar.name.toLowerCase().replace(/[-_]/g, ''),
      );

      if (!matchingField) {
        // Chỉ báo lỗi thiếu biến nếu là biến chính level 01 hoặc 77 có nghiệp vụ rõ ràng
        if (cobVar.level === 1 || cobVar.level === 77) {
          findings.push({
            category: ValidationFindingCategory.VARIABLE_MAPPING_MISMATCH,
            severity: ValidationFindingSeverity.MEDIUM,
            title: `[VARIABLE_MAPPING_MISMATCH] Variable ${cobVar.name} is missing in Java`,
            explanation: `COBOL variable '${cobVar.name}' (Level ${cobVar.level}, ${cobVar.picClause}) was declared in DATA DIVISION but has no corresponding field mapped in Java class.`,
            suggestion: `Add a corresponding field in Java: private ${cobVar.isDecimalOrCurrency ? 'BigDecimal' : cobVar.isNumeric ? 'Long' : 'String'} ${this.toCamelCase(cobVar.name)};`,
            sourceLocation: {
              file: sourceFile.path,
              startLine: cobVar.line,
              endLine: cobVar.line,
            },
            targetLocation: {
              file: targetFile.path,
              startLine: 1,
              endLine: 1,
            },
            expectedBehavior: `Field corresponding to '${cobVar.name}' present in Java model.`,
            actualBehavior: `Field is missing in Java class.`,
            confidence: 0.95,
          });
        }
        continue;
      }

      // Kiểm tra DATA_TYPE_MISMATCH
      const javaType = matchingField.type.toLowerCase();

      // RULE 1.1: Tiền tệ / Fixed-point COMP-3 trong COBOL nhưng dùng float / double trong Java
      if (cobVar.isDecimalOrCurrency) {
        if (javaType === 'float' || javaType === 'double') {
          findings.push({
            category: ValidationFindingCategory.DATA_TYPE_MISMATCH,
            severity: ValidationFindingSeverity.CRITICAL,
            title: `[DATA_TYPE_MISMATCH] ${cobVar.name} uses binary floating-point '${matchingField.type}'`,
            explanation: `COBOL variable '${cobVar.name}' is defined with fixed-point decimal '${cobVar.picClause}' (financial precision), but Java mapped it to '${matchingField.type}'. Binary floating-point causes rounding and precision loss in financial computations.`,
            suggestion: `Change type to java.math.BigDecimal: private BigDecimal ${matchingField.name};`,
            sourceLocation: {
              file: sourceFile.path,
              startLine: cobVar.line,
              endLine: cobVar.line,
            },
            targetLocation: {
              file: targetFile.path,
              startLine: matchingField.line,
              endLine: matchingField.line,
            },
            expectedBehavior: `Fixed-point decimal must map to BigDecimal for accurate financial math.`,
            actualBehavior: `Mapped to floating-point '${matchingField.type}'.`,
            confidence: 1.0,
          });
        } else if (javaType === 'string') {
          findings.push({
            category: ValidationFindingCategory.DATA_TYPE_MISMATCH,
            severity: ValidationFindingSeverity.HIGH,
            title: `[DATA_TYPE_MISMATCH] Numeric ${cobVar.name} mapped to String in Java`,
            explanation: `COBOL numeric/decimal variable '${cobVar.name}' (${cobVar.picClause}) was mapped to Java String, disabling arithmetic computations.`,
            suggestion: `Map to BigDecimal or Long instead of String: private BigDecimal ${matchingField.name};`,
            sourceLocation: {
              file: sourceFile.path,
              startLine: cobVar.line,
              endLine: cobVar.line,
            },
            targetLocation: {
              file: targetFile.path,
              startLine: matchingField.line,
              endLine: matchingField.line,
            },
            expectedBehavior: `Numeric field must map to numeric type (BigDecimal/Long).`,
            actualBehavior: `Mapped to String.`,
            confidence: 0.98,
          });
        }
      }

      // RULE 1.2: Chuỗi PIC X nhưng lại map sang kiểu số trong Java
      if (cobVar.isString && (javaType === 'int' || javaType === 'long' || javaType === 'integer' || javaType === 'double')) {
        findings.push({
          category: ValidationFindingCategory.DATA_TYPE_MISMATCH,
          severity: ValidationFindingSeverity.HIGH,
          title: `[DATA_TYPE_MISMATCH] Alphanumeric ${cobVar.name} mapped to numeric ${matchingField.type}`,
          explanation: `COBOL variable '${cobVar.name}' is alphanumeric (${cobVar.picClause}) but Java mapped it to numeric '${matchingField.type}', risking NumberFormatException if alphanumeric characters are encountered.`,
          suggestion: `Change field type to String: private String ${matchingField.name};`,
          sourceLocation: {
            file: sourceFile.path,
            startLine: cobVar.line,
            endLine: cobVar.line,
          },
          targetLocation: {
            file: targetFile.path,
            startLine: matchingField.line,
            endLine: matchingField.line,
          },
          expectedBehavior: `Alphanumeric PIC X field must map to String.`,
          actualBehavior: `Mapped to ${matchingField.type}.`,
          confidence: 0.98,
        });
      }
    }

    // 2. QUY TẮC: MISSING_OPERATION (Paragraphs trong PROCEDURE DIVISION)
    for (const para of cobol.paragraphs) {
      // Bỏ qua các paragraph nhỏ dạng exit / return thuần túy
      if (/EXIT|GOBACK|END/i.test(para.name)) continue;

      const matchingMethod = java.methods.find(
        (jm) => jm.normalizedName === para.normalizedName || jm.name.toLowerCase() === para.name.toLowerCase().replace(/[-_]/g, ''),
      );

      if (!matchingMethod) {
        findings.push({
          category: ValidationFindingCategory.MISSING_OPERATION,
          severity: ValidationFindingSeverity.HIGH,
          title: `[MISSING_OPERATION] Procedure paragraph ${para.name} is missing in Java`,
          explanation: `COBOL procedure paragraph '${para.name}' in PROCEDURE DIVISION has no corresponding method implementation in Java class.`,
          suggestion: `Implement method: public void ${this.toCamelCase(para.name)}() { /* logic from ${para.name} */ }`,
          sourceLocation: {
            file: sourceFile.path,
            startLine: para.line,
            endLine: para.line,
          },
          targetLocation: {
            file: targetFile.path,
            startLine: 1,
            endLine: 1,
          },
          expectedBehavior: `Java class should provide an equivalent method for paragraph '${para.name}'.`,
          actualBehavior: `No method matching '${para.name}' found in Java class.`,
          confidence: 0.9,
        });
      }
    }

    // 3. QUY TẮC: DATABASE_MISMATCH (EXEC SQL)
    if (cobol.hasExecSql && !java.hasDatabaseOps) {
      findings.push({
        category: ValidationFindingCategory.DATABASE_MISMATCH,
        severity: ValidationFindingSeverity.HIGH,
        title: `[DATABASE_MISMATCH] EXEC SQL statements present in COBOL but missing in Java`,
        explanation: `COBOL source contains embedded EXEC SQL statements, but the converted Java code does not contain any database queries, Spring Data Repository, EntityManager, or JdbcTemplate operations.`,
        suggestion: `Inject a Repository or JdbcTemplate to execute equivalent SQL queries in Java.`,
        sourceLocation: {
          file: sourceFile.path,
          startLine: 1,
          endLine: 1,
        },
        targetLocation: {
          file: targetFile.path,
          startLine: 1,
          endLine: 1,
        },
        expectedBehavior: `Database operations in COBOL must be represented by repository/SQL calls in Java.`,
        actualBehavior: `No database operations detected in Java class.`,
        confidence: 0.95,
      });
    }

    // 4. QUY TẮC: FILE_IO_MISMATCH
    if (cobol.hasFileIo && !java.hasFileIoOps && !java.hasDatabaseOps) {
      findings.push({
        category: ValidationFindingCategory.FILE_IO_MISMATCH,
        severity: ValidationFindingSeverity.MEDIUM,
        title: `[FILE_IO_MISMATCH] File I/O operations present in COBOL but missing in Java`,
        explanation: `COBOL program executes file operations (READ/WRITE/REWRITE on FD), but converted Java code lacks equivalent file stream or persistent storage processing.`,
        suggestion: `Add file processing logic using java.nio.file.Files or BufferedReader/BufferedWriter.`,
        sourceLocation: {
          file: sourceFile.path,
          startLine: 1,
          endLine: 1,
        },
        targetLocation: {
          file: targetFile.path,
          startLine: 1,
          endLine: 1,
        },
        expectedBehavior: `File operations (READ/WRITE) should be handled via Java File I/O or Repository.`,
        actualBehavior: `No File I/O operations detected in Java.`,
        confidence: 0.9,
      });
    }

    return {
      findings,
      summary: {
        cobolVariablesCount: cobol.variables.length,
        cobolParagraphsCount: cobol.paragraphs.length,
        javaFieldsCount: java.fields.length,
        javaMethodsCount: java.methods.length,
      },
    };
  }

  private toCamelCase(str: string): string {
    return str
      .toLowerCase()
      .replace(/[-_]([a-z0-9])/g, (_, g) => g.toUpperCase())
      .replace(/^([A-Z])/, (_, g) => g.toLowerCase());
  }
}
