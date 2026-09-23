import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../../conversions/domain/conversion-job.types';
import { ValidationCodeFile, ValidationContext } from '../domain/validation-context.types';

export interface BuildValidationContextInput {
  organizationId: string;
  projectId: string;
  conversionJobId: string;
}

@Injectable()
export class BuildValidationContextService {
  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly conversionJobs: ConversionJobRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async execute(input: BuildValidationContextInput): Promise<ValidationContext> {
    const conversion = await this.conversionJobs.findById(
      input.conversionJobId,
      input.organizationId,
    );
    if (!conversion || conversion.projectId !== input.projectId) {
      throw new NotFoundException({
        code: 'VALIDATION_CONVERSION_NOT_FOUND',
        message: 'Conversion job was not found for validation',
      });
    }
    if (conversion.status !== ConversionJobStatus.COMPLETED) {
      throw new BadRequestException({
        code: 'VALIDATION_CONVERSION_NOT_READY',
        message: 'Conversion job must be completed before validation context can be built',
      });
    }
    if (!conversion.inputReference) {
      throw new BadRequestException({
        code: 'VALIDATION_SOURCE_NOT_AVAILABLE',
        message: 'Legacy source artifacts are not available for validation',
      });
    }
    if (!conversion.resultReference) {
      throw new BadRequestException({
        code: 'VALIDATION_RESULT_NOT_AVAILABLE',
        message: 'Generated conversion artifacts are not available for validation',
      });
    }

    const [sourceFiles, targetFiles] = await Promise.all([
      this.storage.readFiles(conversion.inputReference),
      this.storage.readFiles(conversion.resultReference),
    ]);

    return {
      conversionJobId: conversion.id,
      organizationId: conversion.organizationId,
      projectId: conversion.projectId,
      screenId: conversion.screenId,
      conversionType: conversion.conversionType,
      sourceFiles: sourceFiles.map((file) => this.decode(file.relativePath, file.content)),
      targetFiles: targetFiles.map((file) => this.decode(file.relativePath, file.content)),
      toolVersion: conversion.toolVersion,
    };
  }

  private decode(path: string, content: Buffer): ValidationCodeFile {
    return { path, content: content.toString('utf8') };
  }
}
