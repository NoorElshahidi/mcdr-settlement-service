import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { SettlementStatus } from '../../common/enums/settlement-status.enum';

export class ListRequestsDto {
  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;
  @ApiPropertyOptional({ description: 'Opaque cursor returned by the previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
  @ApiPropertyOptional({ example: 'CRN-DEMO-001' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  crn?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
