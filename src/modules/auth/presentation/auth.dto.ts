import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'alex@example.com' }) @IsEmail() email!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password!: string;
  @ApiProperty({ example: 'Alex Doe' }) @IsString() @MinLength(2) fullName!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'alex@example.com' }) @IsEmail() email!: string;
  @ApiProperty() @IsString() password!: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() refreshToken!: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token from GIS' }) @IsString() idToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'alex@example.com' }) @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() token!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() currentPassword!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) newPassword!: string;
}

export class SetPasswordDto {
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) newPassword!: string;
}

export class ConfirmMfaSetupDto {
  @ApiProperty({ example: '123456', description: 'Six-digit TOTP verification code' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly six digits' })
  code!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ example: 'alex@example.com' }) @IsEmail() email!: string;
  @ApiProperty({ example: '123456', description: 'Six-digit OTP code or plain verification token' })
  @IsString()
  @MinLength(1)
  code!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'alex@example.com' }) @IsEmail() email!: string;
}
