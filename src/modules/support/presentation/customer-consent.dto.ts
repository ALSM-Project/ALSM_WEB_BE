import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsInt,
  IsObject,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SupportTicketParamsDto } from './support-ticket.dto';

const identifier = /^[^\s\p{Cc}]+$/u;
const account = /^[a-f0-9]{24}$/;
const uuid = /^[0-9a-f-]+$/;

/** Candidate references only. An independent authority must authenticate their intent. */
export class ConsentSourceDto {
  @ApiProperty() @Matches(identifier) @MaxLength(200) authorityId!: string;
  @ApiProperty() @Matches(identifier) @MaxLength(200) evidenceId!: string;
  @ApiProperty() @Matches(identifier) @MaxLength(200) revision!: string;
  @ApiProperty() @Matches(identifier) @MaxLength(200) generation!: string;
}
export class ConsentEvidenceDto extends ConsentSourceDto {
  @ApiProperty({
    enum: ['CURRENT', 'STALE', 'REVOKED', 'EXPIRED', 'INVALIDATED', 'SUPERSEDED', 'UNKNOWN'],
  })
  @IsIn(['CURRENT', 'STALE', 'REVOKED', 'EXPIRED', 'INVALIDATED', 'SUPERSEDED', 'UNKNOWN'])
  status!: 'CURRENT' | 'STALE' | 'REVOKED' | 'EXPIRED' | 'INVALIDATED' | 'SUPERSEDED' | 'UNKNOWN';
}
export class ConsentPersonProposalDto {
  @ApiProperty() @Matches(identifier) @MaxLength(200) personId!: string;
  @ApiProperty() @Matches(account) accountId!: string;
  @ApiProperty({ type: ConsentEvidenceDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentEvidenceDto)
  provenance!: ConsentEvidenceDto;
}
export class ConsentBeneficiaryProposalDto {
  @ApiProperty({ type: ConsentPersonProposalDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentPersonProposalDto)
  identity!: ConsentPersonProposalDto;
  @ApiProperty({ type: ConsentEvidenceDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentEvidenceDto)
  ordinarySession!: ConsentEvidenceDto;
  @ApiProperty({ type: ConsentEvidenceDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentEvidenceDto)
  entitlement!: ConsentEvidenceDto;
}
export class ConsentScopeDto {
  @ApiProperty({ enum: ['UC66'] }) @Equals('UC66') useCase!: 'UC66';
  @ApiProperty() @Matches(identifier) @MaxLength(200) purposeId!: string;
  @ApiProperty({
    enum: ['UC66_READ_PROJECTS', 'UC66_READ_SCREENS', 'UC66_READ_PROGRAMS', 'UC66_READ_LOGS'],
  })
  @IsIn(['UC66_READ_PROJECTS', 'UC66_READ_SCREENS', 'UC66_READ_PROGRAMS', 'UC66_READ_LOGS'])
  operation!: 'UC66_READ_PROJECTS' | 'UC66_READ_SCREENS' | 'UC66_READ_PROGRAMS' | 'UC66_READ_LOGS';
  @ApiProperty() @Matches(identifier) @MaxLength(200) projectionId!: string;
  @ApiProperty() @Matches(identifier) @MaxLength(200) environmentId!: string;
  @ApiProperty({ enum: ['READ_ONLY'] }) @Equals('READ_ONLY') mode!: 'READ_ONLY';
}
export class ConsentCoverageProposalDto {
  @ApiProperty({ enum: ['INDIVIDUAL'] }) @Equals('INDIVIDUAL') kind!: 'INDIVIDUAL';
  @ApiProperty() @Matches(identifier) @MaxLength(200) personId!: string;
  @ApiProperty() @Matches(account) accountId!: string;
}
export class ConsentPolicyProposalDto {
  @ApiProperty() @Matches(identifier) @MaxLength(200) policyId!: string;
  @ApiProperty() @Matches(identifier) @MaxLength(200) version!: string;
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) sha256!: string;
  @ApiProperty({ type: ConsentEvidenceDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentEvidenceDto)
  decisionEvidence!: ConsentEvidenceDto;
}
export class ConsentProposalDto {
  @ApiProperty({ type: ConsentScopeDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentScopeDto)
  scope!: ConsentScopeDto;
  @ApiProperty({ type: ConsentBeneficiaryProposalDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentBeneficiaryProposalDto)
  beneficiary!: ConsentBeneficiaryProposalDto;
  @ApiProperty({ type: ConsentCoverageProposalDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentCoverageProposalDto)
  coverage!: ConsentCoverageProposalDto;
  @ApiProperty({ type: ConsentPolicyProposalDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentPolicyProposalDto)
  policy!: ConsentPolicyProposalDto;
}
export class ConsentTicketContextDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') @Matches(uuid) episodeId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedTicketRevision!: number;
}
export class RequestCustomerConsentDto extends ConsentTicketContextDto {
  @ApiProperty({ type: ConsentProposalDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentProposalDto)
  proposal!: ConsentProposalDto;
  @ApiProperty({ type: ConsentSourceDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentSourceDto)
  source!: ConsentSourceDto;
}
export class DeclineCustomerConsentDto extends ConsentTicketContextDto {
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;
  @ApiProperty({ type: ConsentScopeDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentScopeDto)
  scope!: ConsentScopeDto;
  @ApiProperty({ type: ConsentSourceDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentSourceDto)
  source!: ConsentSourceDto;
}
export class CustomerConsentParamsDto extends SupportTicketParamsDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') @Matches(uuid) consentId!: string;
}
/** Flat bounded query: JSON body fields are never read by GET. */
export class CustomerConsentStatusQueryDto extends ConsentTicketContextDto {
  @Transform(({ value }) =>
    typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  declare expectedTicketRevision: number;
  @ApiProperty() @Matches(identifier) @MaxLength(200) purposeId!: string;
  @ApiProperty({
    enum: ['UC66_READ_PROJECTS', 'UC66_READ_SCREENS', 'UC66_READ_PROGRAMS', 'UC66_READ_LOGS'],
  })
  @IsIn(['UC66_READ_PROJECTS', 'UC66_READ_SCREENS', 'UC66_READ_PROGRAMS', 'UC66_READ_LOGS'])
  operation!: ConsentScopeDto['operation'];
  @ApiProperty() @Matches(identifier) @MaxLength(200) projectionId!: string;
  @ApiProperty() @Matches(identifier) @MaxLength(200) environmentId!: string;
}
export class CustomerConsentResponseDto {
  @ApiProperty({ format: 'uuid' }) consentId!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty({ format: 'uuid' }) ticketId!: string;
  @ApiProperty({ format: 'uuid' }) episodeId!: string;
  @ApiProperty({ enum: ['PENDING_VERIFICATION', 'DECLINED', 'INVALIDATED'] }) state!: string;
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty({ enum: [false] }) operationalAccess!: false;
}
export class CustomerConsentStatusResponseDto extends CustomerConsentResponseDto {
  @ApiProperty({
    enum: ['CURRENT_EPISODE_OPEN', 'TICKET_CLOSED', 'TICKET_CANCELLED', 'EPISODE_CHANGED'],
  })
  ticketCompatibility!: string;
}
