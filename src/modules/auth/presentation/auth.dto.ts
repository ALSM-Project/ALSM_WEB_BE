import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
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
