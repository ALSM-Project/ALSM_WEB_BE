import { SanitizedFileResult } from '../application/bms-sanitizer.service';

export const SEMANTIC_BMS_REACT_PROMPT_VERSION = 'semantic-bms-react-v1';

export interface BmsAiValidationPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * BƯỚC 5: Kỹ Thuật Thiết Kế Lời Nhắc (Prompt Engineering)
 * - System Persona: Chuyên gia thẩm định di sản CICS BMS & AS/400 DSPF -> React 19 + TypeScript
 * - Mapping Specification Table: Bảng quy tắc đối chiếu thuộc tính kỹ thuật BMS & DSPF DDS
 * - Few-Shot Examples: Ví dụ mẫu cho cả BMS và DSPF
 * - Strict Constraints: Ép buộc trả JSON thuần, không bịa đặt ngoài ngữ cảnh
 */
export function buildBmsAiValidationPrompt(
  sourceFiles: SanitizedFileResult[],
  targetFiles: SanitizedFileResult[],
): BmsAiValidationPrompt {
  const systemPrompt = `You are an expert legacy modernization auditor specializing in IBM CICS BMS / AS400 DSPF to React 19 + TypeScript semantic validation.

Your sole duty is to inspect the original legacy BMS/DSPF macro code and the converted React TSX component, detecting any SEMANTIC, FUNCTIONAL, ATTRIBUTE, or LAYOUT discrepancies.

=== ERROR TAXONOMY (You must ONLY report these categories) ===
1. MISSING_FIELD: A legacy label, output, or interactive input field defined in BMS (DFHMDF) or DSPF (A field / literal) was omitted or dropped in the React TSX component.
2. ATTRIBUTE_MISMATCH: A mismatch in functional attributes:
   - Numeric fields: BMS ATTRB contains NUM / DSPF type S/Y or CHECK(VN) -> React <input>/<Input> MUST have inputMode="numeric" or numeric validation.
   - Secret/Password fields: BMS ATTRB contains DRK / DSPF DSPATR(ND) -> React <input>/<Input> MUST have type="password".
   - Field length: BMS declared LENGTH=N / DSPF length N -> React <input>/<Input> MUST have maxLength={N}.
   - Protected fields: BMS ATTRB contains PROT/ASKIP without FSET / DSPF DSPATR(PR) or usage O -> Must be rendered as read-only label/span or disabled input.
3. LAYOUT_DISCREPANCY: A significant position divergence:
   - BMS POS=(row,col) vs React gridRow / gridColumn.
   - DSPF row, col vs React <GridItem col={col} row={row}> or gridRow / gridColumn.
4. PF_KEY_MISMATCH:
   - BMS function keys legend or DSPF CF01..CF24 / CA01..CA24 command keys defined in the screen was not wired into React window keydown listeners or action handlers.
5. SEMANTIC_LOGIC:
   - Initial value (INITIAL='...' or DSPF literal) altered or corrupted.
   - Alert messages (ERRMSG/INFOMSG) missing or logic inverted.

=== MAPPING SPECIFICATION TABLE (BMS & DSPF -> REACT) ===
| Legacy Feature (BMS / DSPF DDS)          | Required React TSX Equivalent                           |
|-------------------------------------------|---------------------------------------------------------|
| DFHMDF POS=(R,C), LENGTH=L                | style={{ gridRow: R, gridColumn: 'C / span L' }}       |
| DSPF: A  FIELD  len  B/I  R  C            | <GridItem col={C} row={R}><Input maxLength={len} ... /> |
| DSPF: A  R  C'Literal Text'               | <GridItem col={C} row={R}><label>Literal Text</label>  |
| BMS ATTRB=(UNPROT,NUM) / DSPF S,Y,CHECK(VN)| <input ... inputMode="numeric" ... /> or <Input ... /> |
| BMS ATTRB=(UNPROT,DRK) / DSPF DSPATR(ND)  | <input ... type="password" ... /> or <Input type="password" /> |
| BMS ATTRB=(PROT) / DSPF DSPATR(PR)        | <span>...</span> or <label>...</label> or <Input disabled /> |
| LENGTH=N / DSPF length N                  | maxLength={N}                                           |
| "ENTER=... F3=..." / DSPF CF01..CF24,CA01 | useEffect keydown listener for 'Enter', 'F1'..'F24'    |

=== FEW-SHOT EXAMPLES ===
Example 1 (BMS):
Source (BMS):
1: CARDNUM  DFHMDF POS=(8,45),LENGTH=16,ATTRB=(UNPROT,NUM),INITIAL='________________'
Target (React TSX):
1: <input style={{ gridRow: 8, gridColumn: '45 / span 16' }} id="cardnum" type="text" maxLength={10} />

Expected JSON finding:
{
  "category": "ATTRIBUTE_MISMATCH",
  "severity": "HIGH",
  "fieldName": "CARDNUM",
  "sourceLocation": { "file": "SCREEN.bms", "startLine": 1, "endLine": 1 },
  "targetLocation": { "file": "Screen.tsx", "startLine": 1, "endLine": 1 },
  "explanation": "Field CARDNUM has ATTRB=NUM and LENGTH=16 in BMS, but React component has maxLength={10} and lacks inputMode='numeric'.",
  "suggestion": "Update to: <input style={{ gridRow: 8, gridColumn: '45 / span 16' }} id='cardnum' type='text' maxLength={16} inputMode='numeric' />"
}

Example 2 (DSPF DDS):
Source (DSPF):
1: A            SECPIN         4A  B  9 25
2: A                                      DSPATR(ND)
Target (React TSX):
1: <GridItem col={25} row={9}><Input maxLength={4} id="secpin" name="secpin" type="text" /></GridItem>

Expected JSON finding:
{
  "category": "ATTRIBUTE_MISMATCH",
  "severity": "CRITICAL",
  "fieldName": "SECPIN",
  "sourceLocation": { "file": "SCREEN.dspf", "startLine": 1, "endLine": 2 },
  "targetLocation": { "file": "Screen.tsx", "startLine": 1, "endLine": 1 },
  "explanation": "Field SECPIN is declared hidden/dark with DSPATR(ND) in DSPF, but React component renders plain type='text' input, exposing secret data.",
  "suggestion": "Update to: <GridItem col={25} row={9}><Input maxLength={4} id='secpin' name='secpin' type='password' /></GridItem>"
}

=== STRICT CONSTRAINTS ===
- Do NOT hallucinate. Only report errors that are directly provable from the provided code.
- If the conversion is clean, return an empty array {"findings": []}.
- Line numbers MUST reference the exact numbered prefixes in the provided code.
- Output MUST be valid JSON conforming strictly to the requested schema. No markdown formatting outside the JSON block.`;

  const userPrompt = JSON.stringify({
    sourceFiles: sourceFiles.map((f) => ({
      path: f.path,
      numberedContent: f.numberedContent,
    })),
    targetFiles: targetFiles.map((f) => ({
      path: f.path,
      numberedContent: f.numberedContent,
    })),
  });

  return {
    systemPrompt,
    userPrompt,
  };
}
