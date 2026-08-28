import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { BackofficeService } from './backoffice.service';
import { RejectRequestDto, SetFeesDto } from './dto/review.dto';
import { ListRequestsDto } from './dto/list-requests.dto';

@Controller('backoffice/settlement-requests')
@Roles(Role.BackofficeEmployee)
export class BackofficeController {
  constructor(private readonly backoffice: BackofficeService) {}

  @Get()
  list(@Query() query: ListRequestsDto) {
    return this.backoffice.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.backoffice.detail(id);
  }

  @Patch(':id/fees') setFees(
    @Param('id') id: string,
    @Req() request: Request,
    @Body() dto: SetFeesDto,
  ) {
    return this.backoffice.setFees(id, request.user?.subject ?? '', dto);
  }

  @Post(':id/approve') approve(@Param('id') id: string, @Req() request: Request) {
    return this.backoffice.decide(id, request.user?.subject ?? '', true);
  }

  @Post(':id/reject') reject(
    @Param('id') id: string,
    @Req() request: Request,
    @Body() dto: RejectRequestDto,
  ) {
    return this.backoffice.decide(id, request.user?.subject ?? '', false, dto.reason);
  }
}
