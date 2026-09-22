import { ConfigService } from '@nestjs/config';
import { PrepareAiValidationContextService } from '../src/modules/validation/application/prepare-ai-validation-context.service';
import { ValidationSecretRedactorService } from '../src/modules/validation/application/validation-secret-redactor.service';
import { ValidationContext } from '../src/modules/validation/domain/validation-context.types';
import { ConversionType } from '../src/modules/projects/domain/project.types';

describe('PrepareAiValidationContextService', () => {
  const values: Record<string, number> = {
    AI_MAX_FILES: 5,
    AI_MAX_FILE_CHARS: 1_000,
    AI_MAX_TOTAL_CHARS: 5_000,
  };
  const config = {
    getOrThrow: jest.fn((key: string) => values[key]),
  };
  const service = new PrepareAiValidationContextService(
    new ValidationSecretRedactorService(),
    config as unknown as ConfigService,
  );
  const context: ValidationContext = {
    conversionJobId: 'job-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionType: ConversionType.COBOL_TO_JAVA,
    sourceFiles: [
      { path: 'z/PROGRAM.cob', content: 'IDENTIFICATION DIVISION.\nPASSWORD="synthetic"' },
      { path: 'a/COPYBOOK.cpy', content: '01 CUSTOMER-ID PIC 9(8).' },
      { path: 'notes.txt', content: 'not provider context' },
    ],
    targetFiles: [
      { path: 'z/Program.java', content: 'class Program {\n  int value;\n}' },
      { path: 'archive.zip', content: 'not provider context' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    values.AI_MAX_FILES = 5;
    values.AI_MAX_FILE_CHARS = 1_000;
    values.AI_MAX_TOTAL_CHARS = 5_000;
  });

  it('selects supported files, sorts them, redacts secrets, and adds stable line numbers', () => {
    const original = structuredClone(context);
    const prepared = service.execute(context);

    expect(prepared.input.sourceFiles).toEqual([
      {
        path: 'a/COPYBOOK.cpy',
        content: '1 | 01 CUSTOMER-ID PIC 9(8).',
        lineCount: 1,
      },
      {
        path: 'z/PROGRAM.cob',
        content: '1 | IDENTIFICATION DIVISION.\n2 | PASSWORD="[REDACTED:SECRET]"',
        lineCount: 2,
      },
    ]);
    expect(prepared.input.targetFiles).toEqual([
      {
        path: 'z/Program.java',
        content: '1 | class Program {\n2 |   int value;\n3 | }',
        lineCount: 3,
      },
    ]);
    expect(prepared.selectedFileCount).toBe(3);
    expect(prepared.redactionCount).toBe(1);
    expect(JSON.stringify(prepared.input)).not.toContain('synthetic');
    expect(context).toEqual(original);
  });

  it('enforces the maximum selected file count', () => {
    values.AI_MAX_FILES = 2;

    expect(() => service.execute(context)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'VALIDATION_CONTEXT_TOO_LARGE' }),
      }),
    );
  });

  it('enforces the maximum size of each selected file', () => {
    values.AI_MAX_FILE_CHARS = 10;

    expect(() => service.execute(context)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'VALIDATION_CONTEXT_TOO_LARGE' }),
      }),
    );
  });

  it('enforces the maximum total prepared context size', () => {
    values.AI_MAX_TOTAL_CHARS = 20;

    expect(() => service.execute(context)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'VALIDATION_CONTEXT_TOO_LARGE' }),
      }),
    );
  });

  it('rejects binary content even when its extension is allowed', () => {
    expect(() =>
      service.execute({
        ...context,
        targetFiles: [{ path: 'Program.java', content: 'class\0Program' }],
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'VALIDATION_UNSUPPORTED_FILE_CONTENT' }),
      }),
    );
  });

  it('rejects contexts with no supported files instead of sending incomplete context', () => {
    expect(() =>
      service.execute({ ...context, sourceFiles: [{ path: 'README.md', content: 'none' }] }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'VALIDATION_CONTEXT_MISSING_SUPPORTED_FILES',
        }),
      }),
    );
  });
});
