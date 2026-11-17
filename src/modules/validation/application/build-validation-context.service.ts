import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import * as path from 'path';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../../conversions/domain/conversion-job.types';
import { SCREEN_REPOSITORY, ScreenRepository } from '../../screens/domain/screen.types';
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
    @Optional() @Inject(SCREEN_REPOSITORY) private readonly screens?: ScreenRepository,
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

    let screenName: string | undefined;
    if (conversion.screenId && this.screens) {
      try {
        const screen = await this.screens.findById(conversion.screenId, input.organizationId);
        screenName = screen?.name;
      } catch {
        // ignore
      }
    }

    const [rawSourceFiles, rawTargetFiles] = await Promise.all([
      this.storage.readFiles(conversion.inputReference),
      this.storage.readFiles(conversion.resultReference),
    ]);

    const decodedSourceFiles = rawSourceFiles.map((file) => this.decode(file.relativePath, file.content));
    const decodedTargetFiles = rawTargetFiles.map((file) => this.decode(file.relativePath, file.content));

    // When an entire repository is uploaded, inputReference holds dozens or hundreds of files.
    // For validating a specific screen/program conversion, select the relevant source files:
    // 1. The primary program source file matching the screen name
    // 2. Any copybooks (.cpy) referenced by the program
    let filteredSourceFiles = decodedSourceFiles;
    if (decodedSourceFiles.length > 5 && screenName) {
      const cleanScreenName = path.basename(screenName).toLowerCase();
      const cleanBaseWithoutExt = cleanScreenName.replace(/\.[^/.]+$/, '');
      const primaryFile = decodedSourceFiles.find(
        (f) => path.basename(f.path).toLowerCase() === cleanScreenName,
      );

      if (primaryFile) {
        // Extract COPY references: e.g. COPY "CVACT01Y" or COPY CVACT01Y.
        const referencedCopybooks = new Set<string>();
        const copyMatches = primaryFile.content.matchAll(/COPY\s+['"]?([A-Za-z0-9_-]+)['"]?/gi);
        for (const match of copyMatches) {
          if (match[1]) referencedCopybooks.add(match[1].toLowerCase());
        }

        const relevant = decodedSourceFiles.filter((f) => {
          const base = path.basename(f.path).toLowerCase();
          const baseWithoutExt = base.replace(/\.[^/.]+$/, '');
          // Always keep the primary file
          if (base === cleanScreenName) return true;
          // Keep copybooks that are referenced
          if (base.endsWith('.cpy') && referencedCopybooks.has(baseWithoutExt)) return true;
          return false;
        });

        // If at least the primary file is found, use the relevant set (or add top copybooks if none referenced)
        if (relevant.length > 0) {
          filteredSourceFiles = relevant;
        } else {
          filteredSourceFiles = [primaryFile];
        }
      } else {
        // Fallback: match by base name without ext
        const matchingFiles = decodedSourceFiles.filter(
          (f) => path.basename(f.path).toLowerCase().startsWith(cleanBaseWithoutExt),
        );
        if (matchingFiles.length > 0) {
          filteredSourceFiles = matchingFiles;
        }
      }
    }

    return {
      conversionJobId: conversion.id,
      organizationId: conversion.organizationId,
      projectId: conversion.projectId,
      screenId: conversion.screenId,
      screenName,
      conversionType: conversion.conversionType,
      sourceFiles: filteredSourceFiles,
      targetFiles: decodedTargetFiles,
      toolVersion: conversion.toolVersion,
    };
  }

  private decode(filePath: string, content: Buffer): ValidationCodeFile {
    return { path: filePath, content: content.toString('utf8') };
  }
}
