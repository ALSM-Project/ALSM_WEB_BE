import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReviewValidationFindingRequestDto } from '../src/modules/validation/presentation/validation.dto';
import { ValidationFindingStatus } from '../src/modules/validation/domain/validation-finding.types';

describe('ReviewValidationFindingRequestDto', () => {
  const validateRequest = (input: Record<string, unknown>) =>
    validate(plainToInstance(ReviewValidationFindingRequestDto, input), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it.each([
    ValidationFindingStatus.NEEDS_CORRECTION,
    ValidationFindingStatus.MANUAL_REVIEW,
    ValidationFindingStatus.NOT_APPLICABLE,
    ValidationFindingStatus.RESOLVED,
  ])('accepts the human-review target status %s', async (status) => {
    await expect(validateRequest({ status })).resolves.toEqual([]);
  });

  it('rejects PENDING as a request target', async () => {
    await expect(validateRequest({ status: ValidationFindingStatus.PENDING })).resolves.not.toEqual(
      [],
    );
  });

  it('rejects a review note longer than 1000 characters', async () => {
    await expect(
      validateRequest({
        status: ValidationFindingStatus.NEEDS_CORRECTION,
        reviewNote: 'x'.repeat(1001),
      }),
    ).resolves.not.toEqual([]);
  });

  it.each([
    'reviewedBy',
    'reviewedAt',
    'organizationId',
    'fingerprint',
    'source',
    'category',
    'severity',
  ])('rejects the server-owned or immutable field %s', async (field) => {
    await expect(
      validateRequest({
        status: ValidationFindingStatus.NEEDS_CORRECTION,
        [field]: 'spoofed-value',
      }),
    ).resolves.not.toEqual([]);
  });
});
