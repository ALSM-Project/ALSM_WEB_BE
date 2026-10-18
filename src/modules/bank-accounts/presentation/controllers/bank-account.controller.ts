import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BankAccountService } from '../../application/services/bank-account.service';
import { CreateBankAccountDto } from '../dto/create-bank-account.dto';
import { UpdateBankAccountDto } from '../dto/update-bank-account.dto';
import {
  DeactivateBankAccountDto,
  QueryBankAccountsDto,
} from '../dto/query-bank-accounts.dto';
import { JwtAuthGuard } from '../../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../../shared/security/require-permissions.decorator';
import { CurrentUser } from '../../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../../shared/logging/request-id.middleware';

@ApiTags('Bank Accounts (Administration)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller(['admin/bank-accounts', 'bank-accounts'])
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @Get()
  @RequirePermissions('bank_accounts.view')
  @ApiOperation({ summary: 'List company receiving bank accounts with pagination and filters' })
  @ApiResponse({ status: 200, description: 'Bank accounts retrieved successfully' })
  async list(@Query() query: QueryBankAccountsDto) {
    return this.bankAccountService.list(query);
  }

  @Get(':id')
  @RequirePermissions('bank_accounts.view')
  @ApiOperation({ summary: 'Get details of a bank account (masked account number)' })
  @ApiResponse({ status: 200, description: 'Bank account details retrieved' })
  async getById(@Param('id') id: string) {
    return this.bankAccountService.getById(id);
  }

  @Post()
  @RequirePermissions('bank_accounts.create')
  @ApiOperation({ summary: 'Add a new company receiving bank account' })
  @ApiResponse({ status: 201, description: 'Bank account registered successfully' })
  async create(
    @Body() dto: CreateBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankAccountService.create(dto, user.userId);
  }

  @Patch(':id')
  @RequirePermissions('bank_accounts.update')
  @ApiOperation({ summary: 'Update an existing receiving bank account' })
  @ApiResponse({ status: 200, description: 'Bank account updated successfully' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankAccountService.update(id, dto, user.userId);
  }

  @Post(':id/set-default')
  @RequirePermissions('bank_accounts.set_default')
  @ApiOperation({ summary: 'Set receiving bank account as default for its currency' })
  @ApiResponse({ status: 200, description: 'Default account updated successfully' })
  async setDefault(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankAccountService.setDefault(id, user.userId);
  }

  @Post(':id/deactivate')
  @RequirePermissions('bank_accounts.deactivate')
  @ApiOperation({ summary: 'Deactivate a company receiving bank account' })
  @ApiResponse({ status: 200, description: 'Bank account deactivated successfully' })
  async deactivate(
    @Param('id') id: string,
    @Body() dto: DeactivateBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankAccountService.deactivate(id, dto.reason, user.userId);
  }

  @Post(':id/reactivate')
  @RequirePermissions('bank_accounts.update')
  @ApiOperation({ summary: 'Reactivate an inactive receiving bank account' })
  @ApiResponse({ status: 200, description: 'Bank account reactivated successfully' })
  async reactivate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankAccountService.reactivate(id, user.userId);
  }

  @Post(':id/reveal-account-number')
  @RequirePermissions('bank_accounts.reveal_sensitive_data')
  @ApiOperation({ summary: 'Reveal full bank account number (audited sensitive operation)' })
  @ApiResponse({ status: 200, description: 'Decrypted account number revealed with security audit' })
  async revealAccountNumber(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankAccountService.revealAccountNumber(id, user.userId);
  }
}
