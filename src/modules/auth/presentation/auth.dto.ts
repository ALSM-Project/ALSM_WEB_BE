import { ApiProperty } from '@nestjs/swagger'; import { IsEmail, IsString, MinLength } from 'class-validator';
export class RegisterDto { @ApiProperty({ example: 'alex@example.com' }) @IsEmail() email!: string; @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) password!: string; @ApiProperty({ example: 'Alex Doe' }) @IsString() @MinLength(2) fullName!: string; }
export class LoginDto { @ApiProperty({ example: 'alex@example.com' }) @IsEmail() email!: string; @ApiProperty() @IsString() password!: string; }
export class RefreshDto { @ApiProperty() @IsString() refreshToken!: string; }
