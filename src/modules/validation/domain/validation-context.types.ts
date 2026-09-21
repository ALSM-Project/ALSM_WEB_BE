import { ConversionType } from '../../projects/domain/project.types';

export interface ValidationCodeFile {
  path: string;
  content: string;
}

export interface ValidationContext {
  conversionJobId: string;
  organizationId: string;
  projectId: string;
  screenId?: string;
  conversionType: ConversionType;
  sourceFiles: ValidationCodeFile[];
  targetFiles: ValidationCodeFile[];
  toolVersion?: string;
}
