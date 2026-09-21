import { FakeAiValidatorAdapter } from '../src/modules/validation/infrastructure/fake-ai-validator.adapter';

describe('FakeAiValidatorAdapter', () => {
  it('returns no findings without pretending validation was performed', async () => {
    const adapter = new FakeAiValidatorAdapter();

    await expect(
      adapter.validate({
        conversionJobId: 'conversion-job-1',
        sourceFiles: [{ path: 'source.cbl', content: 'IDENTIFICATION DIVISION.' }],
        targetFiles: [{ path: 'Target.java', content: 'public class Target {}' }],
      }),
    ).resolves.toEqual({ findings: [] });
  });
});
