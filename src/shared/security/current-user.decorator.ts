import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser, RequestWithContext } from '../logging/request-id.middleware';
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedUser => context.switchToHttp().getRequest<RequestWithContext>().user!);
