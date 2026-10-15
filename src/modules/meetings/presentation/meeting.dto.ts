import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMeetingDto {
  @ApiProperty({ description: 'Title of the meeting room', example: 'Sprint Review — Project Phoenix' })
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: 'Agenda or description for the meeting', example: 'Sprint 14 review and demo' })
  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  description!: string;

  @ApiPropertyOptional({
    description: 'Existing Google Meet link. If omitted, a link is auto-generated.',
    example: 'https://meet.google.com/abc-defg-hij',
  })
  @IsOptional()
  @IsUrl()
  @Matches(/^https:\/\/meet\.google\.com\/[a-z0-9][a-z0-9-]*$/, {
    message: 'customMeetingUrl must be a valid Google Meet link (https://meet.google.com/xxx-yyyy-zzz)',
  })
  customMeetingUrl?: string;

  @ApiProperty({ description: 'Related project ID' })
  @IsNotEmpty()
  @IsString()
  projectId!: string;

  @ApiProperty({ description: 'List of attendee emails (at least 1 required)', type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'attendeeEmails must contain at least 1 email address' })
  @ArrayMaxSize(100)
  @IsEmail({}, { each: true })
  attendeeEmails!: string[];

  @ApiProperty({ description: 'ISO-8601 start time (must be now or future)', example: '2026-10-09T09:00:00.000Z' })
  @IsNotEmpty()
  @IsISO8601()
  scheduledStartTime!: string;

  @ApiProperty({ description: 'ISO-8601 end time (must be after scheduledStartTime)', example: '2026-10-09T10:00:00.000Z' })
  @IsNotEmpty()
  @IsISO8601()
  scheduledEndTime!: string;
}

export class ListMeetingsQueryDto {
  @ApiPropertyOptional({ enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number;
}
