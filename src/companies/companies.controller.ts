import { Controller, Get, Param } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CrnDto } from './dto/crn.dto';
import { CompaniesService } from './companies.service';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Roles(Role.Owner)
  @Get(':crn/settlement-eligibility')
  getEligibility(@Param() params: CrnDto) {
    return this.companies.getEligibility(params.crn);
  }
}
