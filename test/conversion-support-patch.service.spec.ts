import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  CONVERSION_SUPPORT_PATCH_APPLIED,
  ConversionSupportPatchService,
} from '../src/modules/conversions/application/conversion-support-patch.service';
import {
  ConversionJobStatus,
  ConversionPriority,
} from '../src/modules/conversions/domain/conversion-job.types';
import {
  SupportPatchRecord,
  SupportPatchRule,
  countChangedRules,
  validateSupportPatchRules,
} from '../src/modules/conversions/domain/support-patch.types';

const ORG = '6650cc00cc00cc00cc00cc01';
const PROJECT = '6650aa00aa00aa00aa00aa01';
const JOB = '6650ee00ee00ee00ee00ee01';
const STAFF = '6650dd00dd00dd00dd00dd01';

const RULES: SupportPatchRule[] = [
  { sourceField: 'ACCTNO', targetProperty: 'accountNumber', dataType: 'string', transformRule: 'trim' },
  { sourceField: 'CUST_BAL_AMT', targetProperty: 'currentBalance', dataType: 'BigDecimal' },
];

function job(status: ConversionJobStatus, extra: Record<string, unknown> = {}) {
  return {
    id: JOB,
    organizationId: ORG,
    projectId: PROJECT,
    screenId: 'scr-1',
    status,
    priority: ConversionPriority.NORMAL,
    attemptCount: 3,
    maxAttempts: 3,
    executionGeneration: 1,
    ...extra,
  };
}

describe('support patch rules', () => {
  it('accepts well-formed rules', () => {
    expect(validateSupportPatchRules(RULES)).toEqual({ errors: [], warnings: [] });
  });

  it('rejects empty fields, bad identifiers, duplicate sources and a target bound to two types', () => {
    const { errors } = validateSupportPatchRules([
      { sourceField: '', targetProperty: 'x', dataType: 'string' },
      { sourceField: 'A', targetProperty: '1bad', dataType: 'string' },
      { sourceField: 'B', targetProperty: 'total', dataType: 'number' },
      { sourceField: 'b', targetProperty: 'other', dataType: 'string' },
      { sourceField: 'C', targetProperty: 'total', dataType: 'string' },
    ]);
    expect(errors).toEqual([
      'Row 1: the legacy source field is required',
      'Row 2 (A): "1bad" is not a valid property name (letters, digits, _ or $; no leading digit)',
      'Row 4 (b): source field is already mapped in row 3',
      'Row 5 (C): target "total" is string here but number in row 3',
    ]);
  });

  it('warns about transforms that do not fit the type', () => {
    const { errors, warnings } = validateSupportPatchRules([
      { sourceField: 'A', targetProperty: 'a', dataType: 'BigDecimal', transformRule: 'toInt' },
      { sourceField: 'B', targetProperty: 'b', dataType: 'number', transformRule: 'toUpperCase()' },
      { sourceField: 'C', targetProperty: 'c', dataType: 'string', transformRule: 'toCurrency' },
    ]);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(3);
  });

  it('counts added, edited and removed rules', () => {
    expect(countChangedRules(RULES, RULES)).toBe(0);
    expect(
      countChangedRules(RULES, [
        { ...RULES[1], dataType: 'number' },
        { sourceField: 'NEW', targetProperty: 'n', dataType: 'string' },
      ]),
    ).toBe(3);
  });
});

describe('ConversionSupportPatchService', () => {
  const jobs = { findById: jest.fn(), retry: jest.fn(), markFailed: jest.fn() };
  const queue = { enqueue: jest.fn() };
  const patches = { listByJob: jest.fn(), create: jest.fn() };
  const audit = { append: jest.fn() };
  const organizationContext = { resolve: jest.fn() };
  const authorization = { require: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  let service: ConversionSupportPatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    organizationContext.resolve.mockResolvedValue({ id: ORG });
    projects.getForOrganization.mockResolvedValue({ id: PROJECT });
    jobs.findById.mockResolvedValue(job(ConversionJobStatus.DEAD));
    jobs.retry.mockImplementation(async () =>
      job(ConversionJobStatus.QUEUED, { attemptCount: 0, priority: ConversionPriority.HIGH, executionGeneration: 2 }),
    );
    patches.listByJob.mockResolvedValue([]);
    patches.create.mockImplementation(async (input: Omit<SupportPatchRecord, 'id'>) => ({ id: 'patch-1', ...input }));
    service = new ConversionSupportPatchService(
      jobs as never,
      queue as never,
      patches as never,
      audit as never,
      organizationContext as never,
      authorization as never,
      projects as never,
    );
  });

  it('saves the rules, re-queues the job at HIGH priority with attempts reset and audits the note', async () => {
    const result = await service.apply(STAFF, undefined, JOB, {
      rules: [{ ...RULES[1], sourceField: ' cust_bal_amt ' }, RULES[0]],
      note: '  Balance type changed from string to decimal ',
    });

    expect(patches.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        projectId: PROJECT,
        jobId: JOB,
        screenId: 'scr-1',
        rules: [
          { sourceField: 'CUST_BAL_AMT', targetProperty: 'currentBalance', dataType: 'BigDecimal' },
          RULES[0],
        ],
        note: 'Balance type changed from string to decimal',
        changedRuleCount: 2,
        appliedBy: STAFF,
      }),
    );
    expect(jobs.retry).toHaveBeenCalledWith(JOB, ORG, { priority: ConversionPriority.HIGH });
    expect(queue.enqueue).toHaveBeenCalledWith(JOB, ConversionPriority.HIGH, 2);
    expect(audit.append).toHaveBeenCalledWith({
      actorUserId: STAFF,
      organizationId: ORG,
      action: CONVERSION_SUPPORT_PATCH_APPLIED,
      resourceType: 'CONVERSION_JOB',
      resourceId: JOB,
      metadata: {
        patchId: 'patch-1',
        note: 'Balance type changed from string to decimal',
        ruleCount: '2',
        changedRuleCount: '2',
        previousStatus: 'DEAD',
      },
    });
    expect(result.job).toMatchObject({ status: 'QUEUED', attemptCount: 0, priority: 'HIGH' });
  });

  it('counts changes against the previous patch of the job', async () => {
    patches.listByJob.mockResolvedValue([{ id: 'old', rules: RULES }]);
    await service.apply(STAFF, undefined, JOB, {
      rules: [RULES[0], { ...RULES[1], dataType: 'number' }],
      note: 'x',
    });
    expect(patches.create).toHaveBeenCalledWith(expect.objectContaining({ changedRuleCount: 1 }));
  });

  it('refuses invalid rules without saving or re-queuing', async () => {
    const error = await service
      .apply(STAFF, undefined, JOB, {
        rules: [{ sourceField: 'A', targetProperty: '9x', dataType: 'string' }],
        note: 'x',
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'SUPPORT_PATCH_INVALID' });
    expect(patches.create).not.toHaveBeenCalled();
    expect(jobs.retry).not.toHaveBeenCalled();
  });

  it('only patches FAILED or DEAD jobs', async () => {
    jobs.findById.mockResolvedValue(job(ConversionJobStatus.PROCESSING));
    await expect(service.apply(STAFF, undefined, JOB, { rules: RULES, note: 'x' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(patches.create).not.toHaveBeenCalled();
  });

  it('returns 409 when the job was re-queued concurrently', async () => {
    jobs.retry.mockResolvedValue(null);
    await expect(service.apply(STAFF, undefined, JOB, { rules: RULES, note: 'x' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('marks the job failed again and reports it when the queue is down', async () => {
    queue.enqueue.mockRejectedValue(new Error('ECONNREFUSED'));
    const error = await service.apply(STAFF, undefined, JOB, { rules: RULES, note: 'x' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'CONVERSION_QUEUE_UNAVAILABLE' });
    expect(jobs.markFailed).toHaveBeenCalledWith(JOB, 'CONVERSION_QUEUE_UNAVAILABLE', expect.any(String));
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('returns 404 for a job of another organization', async () => {
    jobs.findById.mockResolvedValue(null);
    await expect(service.get(STAFF, undefined, JOB)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads the rules in force and the patch history', async () => {
    patches.listByJob.mockResolvedValue([
      { id: 'p2', rules: RULES },
      { id: 'p1', rules: [] },
    ]);
    const view = await service.get(STAFF, undefined, JOB);
    expect(view.rules).toEqual(RULES);
    expect(view.history.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(view.job.id).toBe(JOB);
  });
});
