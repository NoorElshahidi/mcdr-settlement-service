import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDate,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateMeetingDto {
  @ApiProperty({ example: '2025-01-15T10:00:00.000Z', format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  meetingAt!: Date;

  @ApiProperty({ example: 1000000, minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  capital!: number;

  @ApiProperty({ format: 'uuid' })
  @IsString()
  attachmentDocumentId!: string;
}

export class CreateSettlementRequestDto {
  @ApiProperty({ example: 'CRN-DEMO-001' })
  @IsString()
  crn!: string;

  @ApiProperty({ type: () => [CreateMeetingDto], minItems: 1, maxItems: 20 })
  @ValidateNested({ each: true })
  @Type(() => CreateMeetingDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  meetings!: CreateMeetingDto[];
}
