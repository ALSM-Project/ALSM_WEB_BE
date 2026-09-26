import { ValidationController } from '../src/modules/validation/presentation/validation.controller';
import { ValidationFindingStatus } from '../src/modules/validation/domain/validation-finding.types';

describe('ValidationController human review', () => {
  it('uses authenticated identity and route scope instead of client-owned reviewer metadata', async () => {
    const validationReads = {};
    const triggerAiValidation = {};
    const reviewValidationFinding = { execute: jest.fn().mockResolvedValue({ id: 'finding-1' }) };
    const controller = new ValidationController(
      validationReads as never,
      triggerAiValidation as never,
      reviewValidationFinding as never,
    );

    await expect(
      controller.review(
        { userId: 'reviewer-1', email: 'reviewer@example.com', isPlatformAdmin: false },
        'org-1',
        'project-1',
        'run-1',
        'finding-1',
        {
          status: ValidationFindingStatus.NEEDS_CORRECTION,
          reviewNote: 'Confirmed',
        },
      ),
    ).resolves.toEqual({ id: 'finding-1' });

    expect(reviewValidationFinding.execute).toHaveBeenCalledWith({
      userId: 'reviewer-1',
      organizationHeader: 'org-1',
      projectId: 'project-1',
      validationRunId: 'run-1',
      findingId: 'finding-1',
      status: ValidationFindingStatus.NEEDS_CORRECTION,
      reviewNote: 'Confirmed',
    });
  });
});
