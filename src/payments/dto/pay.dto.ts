import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PayDto {
  @ApiProperty({ minLength: 8, maxLength: 255, example: 'payment-attempt-2025-0001' })
  @IsString()
  @Length(8, 255)
  idempotencyKey!: string;
}
