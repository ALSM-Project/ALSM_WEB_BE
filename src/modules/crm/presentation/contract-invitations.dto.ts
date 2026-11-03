import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class InvitationTokenDto {
  @ApiProperty({ minLength: 64, maxLength: 64, description: 'One-time invitation token. Sent in the POST body.' })
  @IsString()
  @Matches(/^[a-f\d]{64}$/i)
  invitationToken!: string;
}

export class RegisterProspectDto extends InvitationTokenDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
