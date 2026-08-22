import { ApiProperty } from '@nestjs/swagger'; import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
export class RegisterDto { @ApiProperty({ example: 'alex@example.com' }) @IsEmail() email!: string; @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) password!: string; @ApiProperty({ example: 'Alex Doe' }) @IsString() @MinLength(2) fullName!: string; }
export class LoginDto { @ApiProperty({ example: 'alex@example.com' }) @IsEmail() email!: string; @ApiProperty() @IsString() password!: string; }
export class RefreshDto { @ApiProperty() @IsString() refreshToken!: string; }
export class ConfirmMfaSetupDto { @ApiProperty({ example: '123456', description: 'Six-digit TOTP verification code' }) @IsString() @Matches(/^\d{6}$/, { message: 'code must be exactly six digits' }) code!: string; }
