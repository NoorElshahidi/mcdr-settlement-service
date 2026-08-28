import { ArrayMinSize, IsNumber, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class MeetingFeeDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  meetingId!: string;
  @ApiProperty({ example: 1500, minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}

export class SetFeesDto {
  @ApiProperty({ type: () => [MeetingFeeDto], minItems: 1 })
  @ValidateNested({ each: true })
  @Type(() => MeetingFeeDto)
  @ArrayMinSize(1)
  fees!: MeetingFeeDto[];
}

export class RejectRequestDto {
  @ApiProperty({ example: 'Attachment is not legible.' })
  @IsString()
  reason!: string;
}
