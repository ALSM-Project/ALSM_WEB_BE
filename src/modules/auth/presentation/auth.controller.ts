import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService, AuthTokens } from '../application/auth.service';
import { ConfirmMfaSetupService } from '../application/confirm-mfa-setup.service';
import { StartMfaSetupService } from '../application/start-mfa-setup.service';
import {
  ConfirmMfaSetupDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from './auth.dto';
import { MfaPresenter } from './mfa.presenter';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly startMfaSetup: StartMfaSetupService,
    private readonly confirmMfaSetup: ConfirmMfaSetupService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<AuthTokens> {
    return this.auth.register(dto.email, dto.password, dto.fullName);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.auth.login(dto.email, dto.password);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'MFA is already enabled' })
  @Header('Cache-Control', 'no-store')
  @Post('2fa/setup')
  async setupMfa(@CurrentUser() user: AuthenticatedUser) {
    return MfaPresenter.setup(await this.startMfaSetup.execute(user.userId));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid code or MFA setup state' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'MFA state changed' })
  @Header('Cache-Control', 'no-store')
  @Post('2fa/confirm')
  async confirmMfa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmMfaSetupDto,
  ) {
    return MfaPresenter.confirmation(
      await this.confirmMfaSetup.execute(user.userId, dto.code),
    );
  }
}
