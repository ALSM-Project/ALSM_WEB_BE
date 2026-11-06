import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ContractSigningWebhookService } from '../application/contract-signing-webhook.service';

@ApiTags('Contract Signing Webhooks')
@Controller('webhooks/contract-signing')
export class ContractSigningWebhookController {
  constructor(private readonly webhookService: ContractSigningWebhookService) {}

  @Post('vnpt')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleVnptWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    const result = await this.webhookService.handleCallback({
      rawBody,
      headers,
    });

    if (!result.accepted) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_VERIFICATION_FAILED',
        message: 'Invalid webhook callback signature or credentials.',
      });
    }

    return { received: true };
  }
}

