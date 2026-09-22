import { FakeAiValidatorAdapter } from '../src/modules/validation/infrastructure/fake-ai-validator.adapter';

describe('FakeAiValidatorAdapter', () => {
  it('returns no findings without pretending validation was performed', async () => {
    const adapter = new FakeAiValidatorAdapter();

    await expect(
      adapter.validate({
        conversionJobId: 'conversion-job-1',
        sourceFiles: [
          { path: 'source.cbl', content: '1 | IDENTIFICATION DIVISION.', lineCount: 1 },
        ],
        targetFiles: [
          { path: 'Target.java', content: '1 | public class Target {}', lineCount: 1 },
        ],
      }),
    ).resolves.toEqual({ findings: [] });
  });
});
