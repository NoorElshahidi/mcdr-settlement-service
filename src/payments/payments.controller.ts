import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Role } from '../common/enums/role.enum';
import { Roles } from '../common/decorators/roles.decorator';
import { PayDto } from './dto/pay.dto';
import { PaymentsService } from './payments.service';

@Controller('settlement-requests/:id')
@Roles(Role.Owner)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}
  @Get('payment-summary') summary(@Param('id') id: string, @Req() request: Request) {
    return this.payments.summary(id, request.user?.subject ?? '');
  }
  @Post('payment') pay(@Param('id') id: string, @Req() request: Request, @Body() dto: PayDto) {
    return this.payments.pay(id, request.user?.subject ?? '', dto.idempotencyKey);
  }
}
