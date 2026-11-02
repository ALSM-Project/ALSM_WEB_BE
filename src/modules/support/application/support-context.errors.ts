import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupportContextError } from '../domain/support-context.entity';

export function supportDenied(): ForbiddenException {
  return new ForbiddenException({
    code: 'SUPPORT_ACCESS_DENIED',
    message: 'Current Internal Support authority is required',
  });
}
export function supportUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'SUPPORT_ACCESS_UNAVAILABLE',
    message: 'Support access could not be verified',
  });
}
export function supportIdentifier(value: unknown, uuid = false): string {
  if (
    typeof value !== 'string' ||
    !(
      uuid
        ? /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
        : /^[a-f0-9]{24}$/
    ).test(value)
  )
    throw new BadRequestException({
      code: 'INVALID_SUPPORT_IDENTIFIER',
      message: 'A canonical identifier is required',
    });
  return value;
}
export function mapSupportContextError(error: unknown): never {
  if (error instanceof SupportContextError) {
    if (error.code === 'SUPPORT_CONTEXT_INACTIVE')
      throw new ConflictException({
        code: error.code,
        message: 'Support context is no longer active',
      });
    throw supportUnavailable();
  }
  throw error;
}

/** Preserve the original server-generated identity without replaying uncertain work. */
export function supportOperationError(
  error: unknown,
  contextId: string,
  operationId: string,
): never {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED'
    )
      throw new ServiceUnavailableException({
        ...body,
        details: [{ contextId, operationId, mutationCommitted: 'unknown', retrySafe: false }],
      });
  }
  return mapSupportContextError(error);
}
