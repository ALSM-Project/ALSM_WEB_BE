import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService, AuthTokens, RegisterResult } from '../application/auth.service';
import { ConfirmMfaSetupService } from '../application/confirm-mfa-setup.service';
import { StartMfaSetupService } from '../application/start-mfa-setup.service';
import { ForgotPasswordService } from '../application/forgot-password.service';
import { ResetPasswordService } from '../application/reset-password.service';
import { ChangePasswordService } from '../application/change-password.service';
import { SetPasswordService } from '../application/set-password.service';
import {
  ChangePasswordDto,
  ConfirmMfaSetupDto,
  ForgotPasswordDto,
  GoogleLoginDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  SetPasswordDto,
  VerifyEmailDto,
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
    private readonly forgotPasswordService: ForgotPasswordService,
    private readonly resetPasswordService: ResetPasswordService,
    private readonly changePasswordService: ChangePasswordService,
    private readonly setPasswordService: SetPasswordService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<RegisterResult> {
    return this.auth.register(dto.email, dto.password, dto.fullName);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<AuthTokens> {
    return this.auth.verifyEmail(dto.email, dto.code);
  }

  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<{ ok: true }> {
    await this.auth.resendVerification(dto.email);
    return { ok: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.auth.login(dto.email, dto.password);
  }

  @HttpCode(HttpStatus.OK)
  @Post('google')
  async google(@Body() dto: GoogleLoginDto): Promise<AuthTokens> {
    return this.auth.loginWithGoogle(dto.idToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ ok: true }> {
    await this.forgotPasswordService.execute(dto.email);
    return { ok: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ ok: true }> {
    await this.resetPasswordService.execute(dto.token, dto.newPassword);
    return { ok: true };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('set-password')
  async setPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetPasswordDto,
  ): Promise<{ ok: true }> {
    await this.setPasswordService.execute(user.userId, dto.newPassword);
    return { ok: true };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    await this.changePasswordService.execute(user.userId, dto.currentPassword, dto.newPassword);
    return { ok: true };
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
  @Get('sessions')
  async getSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getActiveSessions(user.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('sessions/:id')
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sessionId: string,
  ): Promise<void> {
    await this.auth.revokeSession(user.userId, sessionId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('sessions/revoke-others')
  async revokeAllOtherSessions(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.revokeAllOtherSessions(user.userId);
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
  async confirmMfa(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConfirmMfaSetupDto) {
    return MfaPresenter.confirmation(await this.confirmMfaSetup.execute(user.userId, dto.code));
  }
}

