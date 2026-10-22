import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { ExportOutputOption, FrameworkTarget, StylingOption } from '../domain/export.types';

export class ExportConfigurationDto {
  @ApiProperty({ example: 'scaffold', enum: ['scaffold', 'standalone', 'storybook'] })
  @IsEnum(['scaffold', 'standalone', 'storybook'])
  outputOption!: ExportOutputOption;

  @ApiProperty({ example: 'react-19', enum: ['react-19', 'react-18'] })
  @IsEnum(['react-19', 'react-18'])
  frameworkTarget!: FrameworkTarget;

  @ApiProperty({ example: 'tailwind', enum: ['tailwind', 'css-modules'] })
  @IsEnum(['tailwind', 'css-modules'])
  stylingOption!: StylingOption;

  @ApiProperty({ example: true })
  @IsBoolean()
  includeTypeScriptStrict!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  includeUnitTests!: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  includeStorybook!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  includeDocumentation!: boolean;

  @ApiProperty({ example: ['scr-login', 'scr-dashboard'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  selectedScreenIds!: string[];

  @ApiProperty({ example: 'Acme Corp Modernization', required: false })
  @IsOptional()
  @IsString()
  projectName?: string;
}

export const CUSTOM_NOTES_MAX_LENGTH = 2000;

/** UC-48 packaging options for a partner bundle. */
export class PartnerExportOptionsDto {
  @ApiProperty({
    example: ['6650aa00aa00aa00aa00aa01'],
    type: [String],
    description: 'Screens/programs to package; empty means every item of the project',
  })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  selectedScreenIds!: string[];

  @ApiProperty({ example: true, description: 'Generate tsconfig with strict mode (React bundles)' })
  @IsBoolean()
  includeTypeScript!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  includeUnitTests!: boolean;

  @ApiProperty({ example: true, description: 'README, setup guide and release notes' })
  @IsBoolean()
  includeDocumentation!: boolean;

  @ApiProperty({ example: 'Core Banking Screens', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectName?: string;
}

export class TriggerExportAndNotifyDto {
  @ApiProperty({ example: 'jreynolds@pacificbanking.com' })
  @IsString()
  @IsNotEmpty()
  @IsEmail({}, { message: 'partnerEmail must be a valid email address' })
  @MaxLength(254)
  partnerEmail!: string;

  @ApiProperty({ example: 'All screens passed validation.', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_NOTES_MAX_LENGTH)
  customNotes?: string;

  @ApiProperty({ type: PartnerExportOptionsDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PartnerExportOptionsDto)
  options!: PartnerExportOptionsDto;
}
