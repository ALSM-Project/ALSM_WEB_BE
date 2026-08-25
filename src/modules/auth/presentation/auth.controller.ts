import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RegisterUserService } from '../application/register-user.service';
import { LoginUserService } from '../application/login-user.service';
import { RefreshSessionService } from '../application/refresh-session.service';
import { LogoutSessionService } from '../application/logout-session.service';
import { GetMeService } from '../application/get-me.service';
import { LoginWithGoogleService } from '../application/login-with-google.service';
import { GoogleLoginDto, LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import { AuthPresenter, MeResponse } from './auth.presenter';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { AuthTokens } from '../application/auth-tokens';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUserService,
    private readonly loginUser: LoginUserService,
    private readonly refreshSession: RefreshSessionService,
    private readonly logoutSession: LogoutSessionService,
    private readonly getMe: GetMeService,
    private readonly loginWithGoogle: LoginWithGoogleService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<AuthTokens> {
    const tokens = await this.registerUser.execute({
      email: dto.email,
      password: dto.password,
      fullName: dto.fullName,
    });
    return AuthPresenter.tokens(tokens);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<AuthTokens> {
    const tokens = await this.loginUser.execute({ email: dto.email, password: dto.password });
    return AuthPresenter.tokens(tokens);
  }

  @HttpCode(HttpStatus.OK)
  @Post('google')
  async google(@Body() dto: GoogleLoginDto): Promise<AuthTokens> {
    const tokens = await this.loginWithGoogle.execute({ idToken: dto.idToken });
    return AuthPresenter.tokens(tokens);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    const tokens = await this.refreshSession.execute({ refreshToken: dto.refreshToken });
    return AuthPresenter.tokens(tokens);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.logoutSession.execute({ refreshToken: dto.refreshToken });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return AuthPresenter.me(await this.getMe.execute({ userId: user.userId }));
  }
}
