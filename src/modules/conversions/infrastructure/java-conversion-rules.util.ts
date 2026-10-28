import { FindingSeverity } from '../domain/validation.types';
import { detectAllClassNames, detectJavaMembers } from './java-member-detector.util';

/** One problem found in the Java generated from a COBOL program. */
export interface JavaRuleFinding {
  issueType: string;
  severity: FindingSeverity;
  sourceLocation: string;
  targetLocation: string;
  expectedBehavior: string;
  actualBehavior: string;
  explanation: string;
  suggestion: string;
}

export interface JavaSourceFile {
  relativePath: string;
  content: string;
}

const MAX_LISTED_NAMES = 5;
/** A COMP item holds at most 9 digits in 4 bytes; more digits no longer fit a Java int. */
const MAX_INT_DIGITS = 9;

const COMP_FIELD_PATTERN =
  /([A-Za-z_$][\w$]*)\s*=\s*[\w.]+\.subSequence\([^)]*\)\.withFormat\("([^"]*)"\)\.withOption\("(COMP[-\w]*)"\)/g;

function digitsOf(format: string): number {
  const expanded = format.replace(/9\((\d+)\)/g, (_m, n: string) => '9'.repeat(Number(n)));
  return (expanded.match(/9/g) ?? []).length;
}

function listNames(names: string[]): string {
  const shown = names.slice(0, MAX_LISTED_NAMES).join(', ');
  return names.length > MAX_LISTED_NAMES ? `${shown} and ${names.length - MAX_LISTED_NAMES} more` : shown;
}

/** Rule 1: COMP-1 / COMP-2 floating point, and COMP items too wide for a Java int. */
export function checkDataTypes(files: JavaSourceFile[]): JavaRuleFinding[] {
  const findings: JavaRuleFinding[] = [];
  for (const file of files) {
    const pattern = new RegExp(COMP_FIELD_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(file.content))) {
      const [, field, format, usage] = match;
      if (usage === 'COMP-1' || usage === 'COMP-2') {
        findings.push({
          issueType: 'COMP_FLOATING_POINT',
          severity: FindingSeverity.MEDIUM,
          sourceLocation: `${field} (${usage})`,
          targetLocation: file.relativePath,
          expectedBehavior: 'Exact decimal arithmetic (BigDecimal) for values that must match the mainframe result',
          actualBehavior: `${usage} is a floating point item, so results can differ in the last digits`,
          explanation: `${field} is ${usage}. COBOL floating point and Java float/double round differently, which can change totals.`,
          suggestion:
            'Check every computation that uses this field against the COBOL output; use BigDecimal where the result must be exact.',
        });
      } else if (digitsOf(format) > MAX_INT_DIGITS) {
        findings.push({
          issueType: 'COMP_OVERFLOW_RISK',
          severity: FindingSeverity.HIGH,
          sourceLocation: `${field} (PIC ${format} ${usage})`,
          targetLocation: file.relativePath,
          expectedBehavior: `Values of up to ${digitsOf(format)} digits are stored without loss`,
          actualBehavior: `The value is read as a 32-bit int, which holds at most ${MAX_INT_DIGITS} digits`,
          explanation: `${field} is a binary item of ${digitsOf(format)} digits. Reading it as an int overflows above 2,147,483,647.`,
          suggestion: 'Read the field as a long or BigDecimal wherever it is used.',
        });
      }
    }
  }
  return findings;
}

/** Rule 2: generated class names must be UpperCamelCase and method names lowerCamelCase. */
export function checkNamingConventions(files: JavaSourceFile[]): JavaRuleFinding[] {
  const findings: JavaRuleFinding[] = [];
  for (const file of files) {
    if (!file.relativePath.toLowerCase().endsWith('.java')) continue;
    const badClasses = detectAllClassNames(file.content).filter((n) => !/^[A-Z][A-Za-z0-9]*$/.test(n));
    const badMethods = detectJavaMembers([file])
      .filter((m) => m.kind === 'METHOD' && !/^[a-z][A-Za-z0-9]*$/.test(m.name))
      .map((m) => m.name);
    const violations = [...badClasses.map((n) => `class ${n}`), ...badMethods.map((n) => `${n}()`)];
    if (violations.length === 0) continue;
    findings.push({
      issueType: 'NAMING_CONVENTION',
      severity: FindingSeverity.LOW,
      sourceLocation: file.relativePath,
      targetLocation: listNames(violations),
      expectedBehavior: 'Classes in UpperCamelCase, methods in lowerCamelCase',
      actualBehavior: `${violations.length} name(s) break the Java naming convention`,
      explanation: `The generated names ${listNames(violations)} contain underscores or start in the wrong case.`,
      suggestion: 'Rename them in the Method Mapping editor and save; the renames are applied to the generated code.',
    });
  }
  return findings;
}

const UNSUPPORTED_CONSTRUCTS: { name: string; pattern: RegExp; why: string }[] = [
  {
    name: 'ALTER',
    pattern: /\bALTER\s+[A-Z0-9-]+\s+TO\s+(?:PROCEED\s+TO\s+)?[A-Z0-9-]+/,
    why: 'ALTER changes a GO TO target at run time, which has no Java equivalent.',
  },
  {
    name: 'GO TO ... DEPENDING ON',
    pattern: /\bGO\s+TO\b[^.;\n]*\bDEPENDING\s+ON\b/i,
    why: 'A computed GO TO is not translated to structured control flow.',
  },
];

/** Rule 3: COBOL constructs the converter does not translate completely. */
export function checkUnsupportedConstructs(files: JavaSourceFile[]): JavaRuleFinding[] {
  const findings: JavaRuleFinding[] = [];
  const usesRepository = files.some((f) => /\b\w*Repository\b/.test(f.content));
  for (const file of files) {
    for (const rule of UNSUPPORTED_CONSTRUCTS) {
      if (!rule.pattern.test(file.content)) continue;
      findings.push({
        issueType: 'UNSUPPORTED_CONSTRUCT',
        severity: FindingSeverity.HIGH,
        sourceLocation: `${rule.name} in ${file.relativePath}`,
        targetLocation: file.relativePath,
        expectedBehavior: `${rule.name} translated to equivalent Java control flow`,
        actualBehavior: `${rule.name} remains in the output and is not executable Java`,
        explanation: rule.why,
        suggestion: 'Rewrite this part of the COBOL program with structured PERFORM / EVALUATE, then convert again.',
      });
    }
    if (/\bEXEC\s+SQL\b/i.test(file.content) && !usesRepository) {
      findings.push({
        issueType: 'UNSUPPORTED_CONSTRUCT',
        severity: FindingSeverity.HIGH,
        sourceLocation: `EXEC SQL in ${file.relativePath}`,
        targetLocation: file.relativePath,
        expectedBehavior: 'Embedded SQL mapped to a repository call',
        actualBehavior: 'No repository is used anywhere in the generated Java',
        explanation: 'The program contains EXEC SQL but the generated code has no repository to run it.',
        suggestion: 'Add the repository for the tables this program uses, or move the SQL into a mapped data-access class.',
      });
    }
  }
  return findings;
}

export function validateGeneratedJava(files: JavaSourceFile[]): JavaRuleFinding[] {
  return [...checkDataTypes(files), ...checkNamingConventions(files), ...checkUnsupportedConstructs(files)];
}
