import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TeamKind } from '../domain/team.types';

export class TeamKindQuery {
  @ApiProperty({ enum: TeamKind }) @IsEnum(TeamKind) kind!: TeamKind;
}
export class TeamProjectDto {
  @ApiProperty() @IsMongoId() projectId!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsMongoId({ each: true })
  memberIds!: string[];
}
export class SaveTeamDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiProperty({ enum: TeamKind }) @IsEnum(TeamKind) kind!: TeamKind;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsMongoId({ each: true })
  memberIds!: string[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsMongoId({ each: true })
  managerIds!: string[];
  @ApiProperty({ type: [TeamProjectDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TeamProjectDto)
  projectAssignments!: TeamProjectDto[];
  @ApiProperty({ description: '0 on creation; exact current revision on replacement' })
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
export class TeamPeriodQuery {
  @ApiProperty({ enum: [7, 30] }) @Type(() => Number) @IsInt() @IsIn([7, 30]) days!: 7 | 30;
}
export class AssignTeamJobDto {
  @ApiProperty() @IsMongoId() jobId!: string;
  @ApiProperty() @IsMongoId() memberId!: string;
}
