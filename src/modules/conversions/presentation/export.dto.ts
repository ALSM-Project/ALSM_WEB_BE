import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
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
