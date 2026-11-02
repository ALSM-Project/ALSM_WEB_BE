import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { RecoverSupportContextService } from '../application/recover-support-context.service';
import {
  EmptySupportContextDto,
  SupportContextResponseDto,
  SupportOrganizationParamsDto,
  SupportOrganizationResponseDto,
} from './support-context.dto';
import { SupportContextPresenter } from './support-context.presenter';

export class SupportRecoveryQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  @Matches(/^[a-f0-9-]+$/)
  contextId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  @Matches(/^[a-f0-9-]+$/)
  operationId?: string;
}
class SupportRecoveryOperationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['COMMITTED', 'UNRESOLVED'] }) state!: string;
  @ApiProperty({ type: String, nullable: true }) kind!: string | null;
}
class SupportRecoveryResponseDto {
  @ApiProperty({ enum: ['FOUND', 'UNRESOLVED'] }) outcome!: string;
  @ApiProperty({ type: SupportContextResponseDto, nullable: true })
  context!: SupportContextResponseDto | null;
  @ApiProperty({ type: SupportOrganizationResponseDto, nullable: true })
  organization!: SupportOrganizationResponseDto | null;
  @ApiProperty() usable!: boolean;
  @ApiProperty({ type: SupportRecoveryOperationDto, nullable: true })
  operation!: SupportRecoveryOperationDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) observedAt!: Date;
}
@ApiTags('UC-66 recovery (unregistered)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@Controller('support/organizations/:organizationId/recovery')
export class SupportRecoveryController {
  constructor(private readonly recovery: RecoverSupportContextService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SupportRecoveryResponseDto })
  @ApiOperation({
    summary:
      'Pure own-session context discovery and exact-operation durable evidence; no idle refresh or replay',
  })
  async inspect(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportOrganizationParamsDto,
    @Query() query: SupportRecoveryQueryDto,
    @Body() _body: EmptySupportContextDto,
  ) {
    void _body;
    const result = await this.recovery.execute(
      user,
      params.organizationId,
      query.contextId,
      query.operationId,
    );
    return {
      ...result,
      context: result.context ? SupportContextPresenter.response(result.context) : null,
    };
  }
}
