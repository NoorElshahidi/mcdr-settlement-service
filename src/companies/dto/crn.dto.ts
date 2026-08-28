import { IsString, Length } from 'class-validator';

export class CrnDto {
  @IsString()
  @Length(1, 32)
  crn!: string;
}
