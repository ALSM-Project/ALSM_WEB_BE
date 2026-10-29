/** Data types a field-mapping rule may bind a legacy field to. */
export const SUPPORT_PATCH_DATA_TYPES = [
  'string',
  'number',
  'integer',
  'BigDecimal',
  'boolean',
  'date',
] as const;
export type SupportPatchDataType = (typeof SUPPORT_PATCH_DATA_TYPES)[number];

/** One legacy-field -> modern-property rule edited by Conversion Staff on a failed job. */
export interface SupportPatchRule {
  sourceField: string;
  targetProperty: string;
  dataType: SupportPatchDataType;
  transformRule?: string;
}

/** A support patch applied to a conversion job. Every application is kept as history. */
export interface SupportPatchRecord {
  id: string;
  organizationId: string;
  projectId: string;
  jobId: string;
  screenId?: string;
  rules: SupportPatchRule[];
  note: string;
  /** Rules added, edited or removed compared with the previous patch of this job. */
  changedRuleCount: number;
  appliedBy: string;
  appliedAt: Date;
}

export interface SupportPatchRepository {
  /** Newest first. */
  listByJob(jobId: string, organizationId: string): Promise<SupportPatchRecord[]>;
  create(input: Omit<SupportPatchRecord, 'id'>): Promise<SupportPatchRecord>;
}

export const SUPPORT_PATCH_REPOSITORY = Symbol('SUPPORT_PATCH_REPOSITORY');

export interface SupportPatchValidation {
  errors: string[];
  warnings: string[];
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const NUMERIC_TYPES: ReadonlySet<string> = new Set(['number', 'integer', 'BigDecimal']);
const STRING_ONLY_TRANSFORMS = /\b(toUpperCase|toLowerCase|capitalize\w*)\b/;

function ruleLabel(rule: SupportPatchRule, index: number): string {
  return `Row ${index + 1}${rule.sourceField ? ` (${rule.sourceField})` : ''}`;
}

/**
 * Semantic checks for a patch. Errors block applying it; warnings flag likely data loss.
 * The Web 2 screen runs the same rules before submitting, so both sides agree.
 */
export function validateSupportPatchRules(rules: SupportPatchRule[]): SupportPatchValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const typeByTarget = new Map<string, { type: string; row: number }>();
  const rowBySource = new Map<string, number>();

  rules.forEach((rule, index) => {
    const label = ruleLabel(rule, index);
    const source = rule.sourceField?.trim() ?? '';
    const target = rule.targetProperty?.trim() ?? '';
    const transform = rule.transformRule?.trim() ?? '';

    if (!source) errors.push(`Row ${index + 1}: the legacy source field is required`);
    if (!target) errors.push(`${label}: the target property is required`);
    else if (!IDENTIFIER.test(target)) {
      errors.push(`${label}: "${target}" is not a valid property name (letters, digits, _ or $; no leading digit)`);
    }
    if (!(SUPPORT_PATCH_DATA_TYPES as readonly string[]).includes(rule.dataType)) {
      errors.push(`${label}: unknown data type "${rule.dataType}"`);
    }

    if (source) {
      const key = source.toUpperCase();
      const first = rowBySource.get(key);
      if (first !== undefined) errors.push(`${label}: source field is already mapped in row ${first + 1}`);
      else rowBySource.set(key, index);
    }

    if (target) {
      const previous = typeByTarget.get(target);
      if (previous && previous.type !== rule.dataType) {
        errors.push(
          `${label}: target "${target}" is ${rule.dataType} here but ${previous.type} in row ${previous.row + 1}`,
        );
      } else if (!previous) {
        typeByTarget.set(target, { type: rule.dataType, row: index });
      }
    }

    if (transform) {
      if (rule.dataType === 'BigDecimal' && /\btoInt\b/.test(transform)) {
        warnings.push(`${label}: a toInt transform on BigDecimal drops the decimal places`);
      }
      if (NUMERIC_TYPES.has(rule.dataType) && STRING_ONLY_TRANSFORMS.test(transform)) {
        warnings.push(`${label}: "${transform}" is a text transform but the type is ${rule.dataType}`);
      }
      if (rule.dataType === 'string' && /\b(toCurrency|toInt|toNumber|parseFloat)\b/.test(transform)) {
        warnings.push(`${label}: "${transform}" produces a number but the type is string`);
      }
    }
  });

  return { errors, warnings };
}

/** How many rules differ between two versions (added, removed or edited), keyed by source field. */
export function countChangedRules(previous: SupportPatchRule[], next: SupportPatchRule[]): number {
  const key = (r: SupportPatchRule) => r.sourceField.trim().toUpperCase();
  const before = new Map(previous.map((r) => [key(r), r]));
  const after = new Map(next.map((r) => [key(r), r]));
  let changed = 0;
  for (const [field, rule] of after) {
    const old = before.get(field);
    if (
      !old ||
      old.targetProperty !== rule.targetProperty ||
      old.dataType !== rule.dataType ||
      (old.transformRule ?? '') !== (rule.transformRule ?? '')
    ) {
      changed += 1;
    }
  }
  for (const field of before.keys()) if (!after.has(field)) changed += 1;
  return changed;
}
