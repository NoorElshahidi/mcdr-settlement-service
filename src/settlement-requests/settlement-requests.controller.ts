import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreateSettlementRequestDto } from './dto/create-settlement-request.dto';
import { SettlementRequestsService } from './settlement-requests.service';

@Controller('settlement-requests')
export class SettlementRequestsController {
  constructor(private readonly requests: SettlementRequestsService) {}

  @Post()
  @Roles(Role.Owner)
  create(@Req() request: Request, @Body() dto: CreateSettlementRequestDto) {
    return this.requests.create(request.user as AuthenticatedUser, dto);
  }

  @Get()
  @Roles(Role.Owner)
  list(@Req() request: Request) {
    return this.requests.list(request.user as AuthenticatedUser);
  }

  @Get(':id')
  @Roles(Role.Owner)
  detail(@Req() request: Request, @Param('id') id: string) {
    return this.requests.detail(request.user as AuthenticatedUser, id);
  }
}
