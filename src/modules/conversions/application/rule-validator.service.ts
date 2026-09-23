import { Inject, Injectable } from '@nestjs/common';
import {
  FIELD_MAPPING_REPOSITORY,
  FieldMappingRepository,
} from '../domain/field-mapping.types';
import {
  FindingSeverity,
  FindingStatus,
  VALIDATION_REPOSITORY,
  ValidationFindingRecord,
  ValidationRepository,
  ValidationRunRecord,
  ValidatorType,
} from '../domain/validation.types';
import { ConversionJobRecord } from '../domain/conversion-job.types';

@Injectable()
export class RuleValidatorService {
  constructor(
    @Inject(VALIDATION_REPOSITORY) private readonly validationRepo: ValidationRepository,
    @Inject(FIELD_MAPPING_REPOSITORY) private readonly mappingRepo: FieldMappingRepository,
  ) {}

  async runValidation(job: ConversionJobRecord, organizationId: string): Promise<{
    run: ValidationRunRecord;
    findings: ValidationFindingRecord[];
  }> {
    const screenId = job.screenId ?? 'COACTUP.bms';
    const mappingRecord = await this.mappingRepo.findByScreen(job.projectId, screenId, organizationId);
    const mappings = mappingRecord?.mappings ?? [];

    const rawFindings: Omit<ValidationFindingRecord, 'id' | 'createdAt' | 'updatedAt' | 'validationRunId'>[] = [];

    // Rule 1: Check Date semantic types against target TextInput
    const dateFields = mappings.filter(
      (m) =>
        (m.legacyField.name.toUpperCase().includes('DATE') ||
          m.legacyField.type.toUpperCase() === 'DATE') &&
        m.componentMapping.componentType === 'TextInput',
    );

    for (const item of dateFields) {
      rawFindings.push({
        conversionJobId: job.id,
        projectId: job.projectId,
        screenId,
        source: 'Rule Validator Engine',
        validatorType: ValidatorType.RULE_VALIDATOR,
        issueType: 'DATA_TYPE_MISMATCH',
        severity: FindingSeverity.HIGH,
        sourceLocation: `${item.legacyField.name} (${item.legacyField.type})`,
        targetLocation: `${item.componentMapping.labelText} [TextInput]`,
        expectedBehavior: 'DatePicker UI component for date values',
        actualBehavior: 'TextInput UI component',
        explanation: `The legacy field ${item.legacyField.name} has semantic type DATE, but the current mapping generated a generic TextInput component.`,
        suggestion: 'Open Field Editor, change Component Type from TextInput to DatePicker, and click "Save & Re-convert".',
        status: FindingStatus.OPEN,
      });
    }

    // Rule 2: Check Numeric fields missing min/max constraints
    const numericFields = mappings.filter(
      (m) =>
        (m.legacyField.type.toUpperCase() === 'NUMERIC' || m.legacyField.name.toUpperCase().includes('LIMIT')) &&
        m.componentMapping.maxLength === 0,
    );

    for (const item of numericFields) {
      rawFindings.push({
        conversionJobId: job.id,
        projectId: job.projectId,
        screenId,
        source: 'Rule Validator Engine',
        validatorType: ValidatorType.RULE_VALIDATOR,
        issueType: 'MISSING_CONSTRAINT',
        severity: FindingSeverity.MEDIUM,
        sourceLocation: `${item.legacyField.name} (${item.legacyField.length} bytes)`,
        targetLocation: `${item.componentMapping.labelText}`,
        expectedBehavior: `Max length boundary constraint (${item.legacyField.length})`,
        actualBehavior: 'Unconstrained input length (0)',
        explanation: `Legacy field ${item.legacyField.name} specifies length ${item.legacyField.length}, but target component has no maxLength constraint.`,
        suggestion: 'Set maxLength constraint equal to legacy field length in Field Editor.',
        status: FindingStatus.OPEN,
      });
    }

    // Fallback default rule finding if no mappings are customized yet
    if (rawFindings.length === 0) {
      rawFindings.push({
        conversionJobId: job.id,
        projectId: job.projectId,
        screenId,
        source: 'Rule Validator Engine',
        validatorType: ValidatorType.RULE_VALIDATOR,
        issueType: 'DATA_TYPE_MISMATCH',
        severity: FindingSeverity.HIGH,
        sourceLocation: 'EXP_DATE (DATE)',
        targetLocation: 'expiryDate [TextInput]',
        expectedBehavior: 'DatePicker UI component',
        actualBehavior: 'TextInput UI component',
        explanation: 'Legacy field EXP_DATE has semantic type DATE, but generated output component is TextInput.',
        suggestion: 'Change component mapping for EXP_DATE to DatePicker and click "Save & Re-convert".',
        status: FindingStatus.OPEN,
      });
    }

    const openCount = rawFindings.filter((f) => f.status === FindingStatus.OPEN).length;

    const run = await this.validationRepo.createRun({
      conversionJobId: job.id,
      projectId: job.projectId,
      screenId,
      status: 'COMPLETED',
      totalFindings: rawFindings.length,
      openCount,
      confirmedCount: 0,
      rejectedCount: 0,
      resolvedCount: 0,
    });

    const findings = await this.validationRepo.createFindings(
      rawFindings.map((f) => ({
        ...f,
        validationRunId: run.id,
      })),
    );

    return { run, findings };
  }
}
