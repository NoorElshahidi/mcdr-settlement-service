import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './entities/company.entity';

@Injectable()
export class CompaniesService {
  constructor(@InjectRepository(Company) private readonly companies: Repository<Company>) {}

  async getEligibility(rawCrn: string): Promise<{
    crn: string;
    companyName: string;
    settlementRequired: boolean;
    reason: string | null;
  }> {
    const crn = rawCrn.trim().toUpperCase();
    const company = await this.companies.findOne({
      where: { crn },
      select: ['id', 'crn', 'name', 'settlementRequired', 'eligibilityReason'],
    });
    if (!company) throw new NotFoundException('Company was not found');
    return {
      crn: company.crn,
      companyName: company.name,
      settlementRequired: company.settlementRequired,
      reason: company.eligibilityReason,
    };
  }
}
