import { IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';

export class DiscountRequestDto {
  @IsMongoId()
  leadId!: string;

  @IsString()
  @MaxLength(100)
  quoteId!: string;
}

export class RejectDiscountDto extends DiscountRequestDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
