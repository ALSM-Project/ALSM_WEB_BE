import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request & { requestId?: string }>();

    // Handle Mongoose / BSON Cast Errors for non-ObjectId parameter strings (e.g. scr-acct010, proj-acme)
    const errName = (exception as { name?: string })?.name;
    if (errName === 'CastError' || errName === 'BSONError') {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        code: 'RESOURCE_NOT_FOUND',
        message: 'Requested resource was not found',
        details: [(exception as Error).message],
        requestId: request.requestId,
      });
      return;
    }

    const http = exception instanceof HttpException ? exception : undefined;
    if (!http) {
      console.error('[ApiExceptionFilter] Internal Server Error:', exception);
    }
    const statusCode = http?.getStatus() ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const body = http?.getResponse();
    const values = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const messages = values.message;
    response.status(statusCode).json({
      statusCode,
      code: values.code ?? (statusCode === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_SERVER_ERROR'),
      message:
        typeof messages === 'string'
          ? messages
          : statusCode === 400
          ? 'Request validation failed'
          : 'An unexpected error occurred',
      details: Array.isArray(messages) ? messages : values.details ?? [],
      requestId: request.requestId,
    });
  }
}
