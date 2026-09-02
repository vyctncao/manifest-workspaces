import { Controller, Get, Query } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../../common/decorators/tenant-context.decorator';
import { PlanUsageService } from './plan-usage.service';

@Controller('api/v1/routing/plan-usage')
export class PlanUsageController {
  constructor(private readonly usageService: PlanUsageService) {}

  @Get()
  getUsage(@TenantCtx() ctx: TenantContext, @Query('refresh') refresh?: string) {
    if (!ctx.tenantId) return { fetchedAt: new Date().toISOString(), connections: [] };
    return this.usageService.getUsage(ctx.tenantId, refresh === 'true');
  }
}
