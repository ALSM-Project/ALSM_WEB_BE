import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import {
  AiValidationCodeFile,
  AiValidationInput,
} from '../domain/ai-validator.port';
import { ValidationCodeFile, ValidationContext } from '../domain/validation-context.types';
import { ValidationSecretRedactorService } from './validation-secret-redactor.service';

const SOURCE_EXTENSIONS = new Set(['.cob', '.cbl', '.cpy']);
const TARGET_EXTENSIONS = new Set(['.java']);

export interface PreparedAiValidationContext {
  input: AiValidationInput;
  redactionCount: number;
  selectedFileCount: number;
  inputCharacterCount: number;
}

interface ContextLimits {
  maxFiles: number;
  maxFileCharacters: number;
  maxTotalCharacters: number;
}

@Injectable()
export class PrepareAiValidationContextService {
  constructor(
    private readonly redactor: ValidationSecretRedactorService,
    private readonly config: ConfigService,
  ) {}

  execute(context: ValidationContext): PreparedAiValidationContext {
    const limits = this.getLimits();
    const sourceFiles = this.select(context.sourceFiles, SOURCE_EXTENSIONS, 'source');
    const targetFiles = this.select(context.targetFiles, TARGET_EXTENSIONS, 'target');
    const selectedFileCount = sourceFiles.length + targetFiles.length;

    if (selectedFileCount > limits.maxFiles) {
      this.contextTooLarge('Selected file count exceeds the configured AI validation limit');
    }

    let redactionCount = 0;
    const prepare = (file: ValidationCodeFile): AiValidationCodeFile => {
      if (file.content.length > limits.maxFileCharacters) {
        this.contextTooLarge('A selected file exceeds the configured AI validation size limit');
      }
      if (this.looksBinary(file.content)) {
        throw new BadRequestException({
          code: 'VALIDATION_UNSUPPORTED_FILE_CONTENT',
          message: 'A selected validation file does not contain supported text content',
        });
      }

      const redacted = this.redactor.redact(file.content);
      redactionCount += redacted.redactionCount;
      const lines = redacted.content.split(/\r\n|\n|\r/);
      return {
        path: file.path,
        content: lines.map((line, index) => `${index + 1} | ${line}`).join('\n'),
        lineCount: lines.length,
      };
    };

    const preparedSourceFiles = sourceFiles.map(prepare);
    const preparedTargetFiles = targetFiles.map(prepare);
    const inputCharacterCount = [...preparedSourceFiles, ...preparedTargetFiles].reduce(
      (total, file) => total + file.content.length,
      0,
    );

    if (inputCharacterCount > limits.maxTotalCharacters) {
      this.contextTooLarge('Prepared context exceeds the configured AI validation size limit');
    }

    return {
      input: {
        conversionJobId: context.conversionJobId,
        sourceFiles: preparedSourceFiles,
        targetFiles: preparedTargetFiles,
      },
      redactionCount,
      selectedFileCount,
      inputCharacterCount,
    };
  }

  private select(
    files: ValidationCodeFile[],
    extensions: ReadonlySet<string>,
    kind: 'source' | 'target',
  ): ValidationCodeFile[] {
    const selected = files
      .filter((file) => extensions.has(path.extname(file.path).toLowerCase()))
      .map((file) => ({ path: file.path.replace(/\\/g, '/'), content: file.content }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

    if (selected.length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_CONTEXT_MISSING_SUPPORTED_FILES',
        message: `AI validation requires at least one supported ${kind} file`,
      });
    }

    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      if (path.posix.isAbsolute(file.path) || file.path.split('/').includes('..')) {
        throw new BadRequestException({
          code: 'VALIDATION_UNSAFE_FILE_PATH',
          message: 'A selected validation file has an unsafe path',
        });
      }
      if (index > 0 && selected[index - 1].path === file.path) {
        throw new BadRequestException({
          code: 'VALIDATION_DUPLICATE_FILE_PATH',
          message: 'Selected validation files must have unique relative paths',
        });
      }
    }

    return selected;
  }

  private getLimits(): ContextLimits {
    return {
      maxFiles: this.config.getOrThrow<number>('AI_MAX_FILES'),
      maxFileCharacters: this.config.getOrThrow<number>('AI_MAX_FILE_CHARS'),
      maxTotalCharacters: this.config.getOrThrow<number>('AI_MAX_TOTAL_CHARS'),
    };
  }

  private looksBinary(content: string): boolean {
    return content.includes('\0');
  }

  private contextTooLarge(message: string): never {
    throw new BadRequestException({ code: 'VALIDATION_CONTEXT_TOO_LARGE', message });
  }
}
