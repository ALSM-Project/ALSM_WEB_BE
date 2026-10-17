import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LeadRecord } from '../domain/lead.types';
export function salesId(value: string): string {
  if (!/^[a-f0-9]{24}$/i.test(value))
    throw new BadRequestException('A canonical persisted identifier is required');
  return value.toLowerCase();
}
export function evidenceReference(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,199}$/.test(value))
    throw new BadRequestException('A bounded business evidence reference is required');
  return value;
}
export function expectedRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new BadRequestException('A positive current revision is required');
  return value;
}
export function requireLead(lead: LeadRecord | null): LeadRecord {
  if (!lead)
    throw new NotFoundException({
      code: 'LEAD_NOT_FOUND',
      message: 'Lead is unavailable in this organization',
    });
  return lead;
}
export function requireSaved(lead: LeadRecord | null): LeadRecord {
  if (!lead)
    throw new ConflictException({
      code: 'LEAD_REVISION_CONFLICT',
      message: 'Lead changed; reconcile its current revision before another operation',
    });
  return lead;
}
