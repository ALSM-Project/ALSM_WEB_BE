import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  SUPPORT_TICKET_PAGE_DEFAULT,
  SUPPORT_TICKET_PAGE_MAX,
} from '../domain/support-ticket-listing.port';
import type { SupportTicketStatus } from '../domain/support-ticket.types';

export class SupportTicketOrganizationParamsDto {
  @ApiProperty({ pattern: '^[a-f0-9]{24}$' })
  @Matches(/^[a-f0-9]{24}$/)
  organizationId!: string;
}

export class SupportTicketParamsDto extends SupportTicketOrganizationParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  ticketId!: string;
}

export class CreateSupportTicketDto {
  @ApiProperty({ example: 'diagnose-rendering', maxLength: 200 })
  @IsString()
  @Matches(/^[^\s\p{Cc}]+$/u)
  @MaxLength(200)
  purposeId!: string;
}

export class TransitionSupportTicketDto {
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;
}

export class ListSupportTicketsDto {
  @ApiPropertyOptional({
    default: SUPPORT_TICKET_PAGE_DEFAULT,
    minimum: 1,
    maximum: SUPPORT_TICKET_PAGE_MAX,
  })
  @Transform(({ value }) =>
    typeof value === 'string' && /^[1-9]\d?$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(SUPPORT_TICKET_PAGE_MAX)
  limit: number = SUPPORT_TICKET_PAGE_DEFAULT;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  afterTicketId?: string;
}

/** Ensures non-list routes reject unrecognized query/identity claims too. */
export class EmptySupportTicketQueryDto {}

export class SupportTicketResponseDto {
  @ApiProperty({ format: 'uuid' }) ticketId!: string;
  @ApiProperty({ pattern: '^[a-f0-9]{24}$' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) episodeId!: string;
  @ApiProperty() purposeId!: string;
  @ApiProperty({ enum: ['OPEN', 'CLOSED', 'CANCELLED'] }) status!: SupportTicketStatus;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) revision!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SupportTicketPageResponseDto {
  @ApiProperty({ type: [SupportTicketResponseDto], maxItems: SUPPORT_TICKET_PAGE_MAX })
  items!: SupportTicketResponseDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  nextAfterTicketId!: string | null;
}
