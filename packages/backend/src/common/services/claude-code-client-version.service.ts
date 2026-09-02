import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { refreshClaudeCodeVersion } from '../constants/subscription-clients';

@Injectable()
export class ClaudeCodeClientVersionService implements OnModuleInit {
  private readonly logger = new Logger(ClaudeCodeClientVersionService.name);

  onModuleInit(): void {
    void this.refresh();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async refresh(): Promise<void> {
    const version = await refreshClaudeCodeVersion();
    if (version) this.logger.log(`Claude Code client identity updated to ${version}`);
  }
}
