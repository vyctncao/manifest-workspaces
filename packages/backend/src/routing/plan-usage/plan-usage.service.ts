import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getSubscriptionProviderConfig } from 'manifest-shared';
import { TenantProvider } from '../../entities/tenant-provider.entity';
import { decrypt, getEncryptionSecret } from '../../common/utils/crypto.util';
import { parseOAuthTokenBlob } from '../oauth/core';

export interface PlanUsageWindow {
  id: string;
  label: string;
  usedPct: number | null;
  remainingPct: number | null;
  resetsAt: string | null;
}

export interface PlanUsageBalance {
  id: string;
  label: string;
  used: number | null;
  remaining: number | null;
  limit: number | null;
  unit: string;
  resetsAt: string | null;
}

export interface PlanUsageConnection {
  connectionId: string;
  providerId: string;
  displayName: string;
  label: string;
  status: 'available' | 'unavailable' | 'error';
  planLabel: string | null;
  windows: PlanUsageWindow[];
  balances: PlanUsageBalance[];
  details: Array<{ id: string; label: string; value: string }>;
  message: string | null;
}

export interface PlanUsageResponse {
  fetchedAt: string;
  connections: PlanUsageConnection[];
}

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60_000;
const DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'Codex',
  minimax: 'MiniMax',
  moonshot: 'Kimi',
  xai: 'Grok',
  zai: 'Z.ai',
  copilot: 'GitHub Copilot',
  gemini: 'Gemini',
  byteplus: 'BytePlus',
  mistral: 'Mistral Vibe',
  xiaomi: 'Xiaomi MiMo',
  qwen: 'Qwen',
  nous: 'NousResearch',
  'ollama-cloud': 'Ollama Cloud',
  kiro: 'Kiro',
  'opencode-go': 'OpenCode Go',
  commandcode: 'Command Code',
  'cline-pass': 'Cline Pass',
};

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function windowFromUsed(
  id: string,
  label: string,
  usedValue: unknown,
  resetsAt?: unknown,
): PlanUsageWindow | null {
  const usedPct = numberValue(usedValue);
  if (usedPct === null) return null;
  const bounded = Math.max(0, Math.min(100, usedPct));
  return {
    id,
    label,
    usedPct: bounded,
    remainingPct: Math.max(0, 100 - bounded),
    resetsAt: stringValue(resetsAt),
  };
}

function epochSecondsToIso(value: unknown): string | null {
  const seconds = numberValue(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function jwtAccountId(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>;
    const auth = recordValue(payload['https://api.openai.com/auth']);
    return stringValue(auth?.chatgpt_account_id) ?? stringValue(payload.chatgpt_account_id);
  } catch {
    return null;
  }
}

@Injectable()
export class PlanUsageService {
  private readonly logger = new Logger(PlanUsageService.name);
  private readonly cache = new Map<string, { expiresAt: number; value: PlanUsageResponse }>();

  constructor(
    @InjectRepository(TenantProvider)
    private readonly providerRepo: Repository<TenantProvider>,
  ) {}

  async getUsage(tenantId: string, force = false): Promise<PlanUsageResponse> {
    const cached = this.cache.get(tenantId);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.value;

    const providers = await this.providerRepo.find({
      where: { tenant_id: tenantId, auth_type: 'subscription', is_active: true },
      order: { provider: 'ASC', priority: 'ASC' },
    });
    const connections = await Promise.all(
      providers.map((provider) => this.fetchProvider(provider)),
    );
    const value = { fetchedAt: new Date().toISOString(), connections };
    this.cache.set(tenantId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  }

  private async fetchProvider(provider: TenantProvider): Promise<PlanUsageConnection> {
    const base = this.baseConnection(provider);
    const credential = this.readCredential(provider);
    if (!credential) return { ...base, status: 'unavailable', message: 'Credential unavailable.' };

    try {
      switch (provider.provider.toLowerCase()) {
        case 'anthropic':
          return await this.fetchClaude(base, credential);
        case 'openai':
          return await this.fetchCodex(base, credential);
        case 'minimax':
          return await this.fetchMiniMax(base, credential, provider.region);
        case 'moonshot':
          return await this.fetchKimi(base, credential);
        case 'xai':
          return await this.fetchGrok(base, credential);
        case 'zai':
          return await this.fetchZai(base, credential, provider.region);
        case 'copilot':
          return await this.fetchCopilot(base, credential);
        default:
          return {
            ...base,
            status: 'unavailable',
            message: 'This provider does not expose plan usage through its subscription API.',
          };
      }
    } catch (error) {
      this.logger.warn(`Plan usage fetch failed for ${provider.provider} (${provider.id})`);
      return {
        ...base,
        status: 'error',
        message: error instanceof Error ? error.message : 'Usage fetch failed.',
      };
    }
  }

  private baseConnection(provider: TenantProvider): PlanUsageConnection {
    const providerId = provider.provider.toLowerCase();
    return {
      connectionId: provider.id,
      providerId,
      displayName:
        DISPLAY_NAMES[providerId] ??
        getSubscriptionProviderConfig(providerId)?.subscriptionLabel ??
        provider.provider,
      label: provider.label,
      status: 'available',
      planLabel: null,
      windows: [],
      balances: [],
      details: [],
      message: null,
    };
  }

  private readCredential(provider: TenantProvider): string | null {
    if (!provider.api_key_encrypted) return null;
    try {
      const raw = decrypt(provider.api_key_encrypted, getEncryptionSecret());
      return parseOAuthTokenBlob(raw)?.t ?? raw;
    } catch {
      return null;
    }
  }

  private async getJson(url: string, token: string, headers: Record<string, string> = {}) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers },
    });
    if (!response.ok) throw new Error(`Usage API returned ${response.status}`);
    return (await response.json()) as unknown;
  }

  private async fetchClaude(
    base: PlanUsageConnection,
    token: string,
  ): Promise<PlanUsageConnection> {
    const body = recordValue(
      await this.getJson('https://api.anthropic.com/api/oauth/usage', token, {
        'anthropic-beta': 'oauth-2025-04-20',
      }),
    );
    const windows: PlanUsageWindow[] = [];
    const rows: Array<[string, string, unknown]> = [
      ['five_hour', '5-hour', body?.five_hour],
      ['seven_day', 'Weekly', body?.seven_day],
      ['seven_day_opus', 'Weekly · Opus', body?.seven_day_opus],
      ['seven_day_omelette', 'Weekly · Fable', body?.seven_day_omelette],
    ];
    for (const [id, label, value] of rows) {
      const row = recordValue(value);
      const window = windowFromUsed(id, label, row?.utilization, row?.resets_at);
      if (window) windows.push(window);
    }
    return { ...base, windows, status: windows.length ? 'available' : 'unavailable' };
  }

  private async fetchCodex(base: PlanUsageConnection, token: string): Promise<PlanUsageConnection> {
    const accountId = jwtAccountId(token);
    const body = recordValue(
      await this.getJson('https://chatgpt.com/backend-api/wham/usage', token, {
        ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
        'User-Agent': 'Mozilla/5.0',
      }),
    );
    const limits = recordValue(body?.rate_limit);
    const review = recordValue(body?.code_review_rate_limit);
    const windows: PlanUsageWindow[] = [];
    for (const [id, label, value] of [
      ['session', '5-hour', limits?.primary_window],
      ['weekly', 'Weekly', limits?.secondary_window],
      ['code_review', 'Code review', review?.primary_window],
    ] as const) {
      const row = recordValue(value);
      const window = windowFromUsed(id, label, row?.used_percent, epochSecondsToIso(row?.reset_at));
      if (window) windows.push(window);
    }
    const credits = recordValue(body?.credits);
    const balance = numberValue(credits?.balance);
    return {
      ...base,
      planLabel: stringValue(body?.plan_type),
      windows,
      balances:
        balance === null
          ? []
          : [
              {
                id: 'credits',
                label: 'Credits',
                used: null,
                remaining: balance,
                limit: null,
                unit: 'USD',
                resetsAt: null,
              },
            ],
      status: windows.length || balance !== null ? 'available' : 'unavailable',
    };
  }

  private async fetchMiniMax(
    base: PlanUsageConnection,
    token: string,
    region: string | null,
  ): Promise<PlanUsageConnection> {
    const host = region === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io';
    const body = recordValue(await this.getJson(`${host}/v1/token_plan/remains`, token));
    const models = Array.isArray(body?.model_remains) ? body.model_remains : [];
    const windows: PlanUsageWindow[] = [];
    for (const [index, value] of models.entries()) {
      const row = recordValue(value);
      const name = stringValue(row?.model_name) ?? `Model ${index + 1}`;
      const intervalRemaining = numberValue(row?.current_interval_remaining_percent);
      const weeklyRemaining = numberValue(row?.current_weekly_remaining_percent);
      const interval = windowFromUsed(
        `interval_${index}`,
        `${name} · Interval`,
        intervalRemaining === null ? null : 100 - intervalRemaining,
        numberValue(row?.end_time) ? new Date(numberValue(row?.end_time)!).toISOString() : null,
      );
      const weekly = windowFromUsed(
        `weekly_${index}`,
        `${name} · Weekly`,
        weeklyRemaining === null ? null : 100 - weeklyRemaining,
        numberValue(row?.weekly_end_time)
          ? new Date(numberValue(row?.weekly_end_time)!).toISOString()
          : null,
      );
      if (interval) windows.push(interval);
      if (weekly) windows.push(weekly);
    }
    return { ...base, windows, status: windows.length ? 'available' : 'unavailable' };
  }

  private async fetchKimi(base: PlanUsageConnection, token: string): Promise<PlanUsageConnection> {
    const body = recordValue(await this.getJson('https://api.kimi.com/coding/v1/usages', token));
    const rows = [body?.usage, ...(Array.isArray(body?.limits) ? body.limits : [])];
    const windows: PlanUsageWindow[] = [];
    for (const [index, value] of rows.entries()) {
      const outer = recordValue(value);
      const row = recordValue(outer?.detail) ?? outer;
      const limit = numberValue(row?.limit);
      const used = numberValue(row?.used);
      const remaining = numberValue(row?.remaining);
      const usedPct =
        limit && limit > 0 ? ((used ?? limit - (remaining ?? limit)) / limit) * 100 : null;
      const window = windowFromUsed(
        `limit_${index}`,
        stringValue(row?.name) ??
          stringValue(outer?.name) ??
          (index ? `Limit ${index + 1}` : 'Weekly'),
        usedPct,
        row?.resetTime ?? row?.resetAt ?? row?.reset_time ?? row?.reset_at,
      );
      if (window) windows.push(window);
    }
    return { ...base, windows, status: windows.length ? 'available' : 'unavailable' };
  }

  private async fetchGrok(base: PlanUsageConnection, token: string): Promise<PlanUsageConnection> {
    const body = recordValue(
      await this.getJson('https://cli-chat-proxy.grok.com/v1/billing', token, {
        'X-XAI-Token-Auth': 'xai-grok-cli',
      }),
    );
    const config = recordValue(body?.config);
    const limit = numberValue(recordValue(config?.monthlyLimit)?.val);
    const used =
      numberValue(recordValue(config?.used)?.val) ??
      numberValue(recordValue(body?.usage)?.creditUsage);
    const remaining = limit !== null && used !== null ? Math.max(0, limit - used) : null;
    return {
      ...base,
      balances:
        limit === null && used === null
          ? []
          : [
              {
                id: 'credits',
                label: 'Monthly credits',
                used,
                remaining,
                limit,
                unit: 'credits',
                resetsAt: stringValue(config?.billingPeriodEnd),
              },
            ],
      status: limit !== null || used !== null ? 'available' : 'unavailable',
    };
  }

  private async fetchZai(
    base: PlanUsageConnection,
    token: string,
    region: string | null,
  ): Promise<PlanUsageConnection> {
    const host = region === 'cn' ? 'https://open.bigmodel.cn' : 'https://api.z.ai';
    const body = recordValue(await this.getJson(`${host}/api/biz/subscription/list`, token));
    const row = recordValue(Array.isArray(body?.data) ? body.data[0] : null);
    if (!row) return { ...base, status: 'unavailable' as const };
    return {
      ...base,
      planLabel: stringValue(row.productName),
      details: [
        ...(stringValue(row.status)
          ? [{ id: 'status', label: 'Status', value: stringValue(row.status)! }]
          : []),
        ...(stringValue(row.valid)
          ? [{ id: 'valid', label: 'Valid through', value: stringValue(row.valid)! }]
          : []),
      ],
    };
  }

  private async fetchCopilot(
    base: PlanUsageConnection,
    token: string,
  ): Promise<PlanUsageConnection> {
    const body = recordValue(
      await this.getJson('https://api.github.com/copilot_internal/user', token, {
        Authorization: `token ${token}`,
        'Editor-Version': 'vscode/1.100.0',
        'Editor-Plugin-Version': 'copilot/1.300.0',
      }),
    );
    const reset = stringValue(body?.quota_reset_date);
    return {
      ...base,
      planLabel: stringValue(body?.copilot_plan),
      details: reset ? [{ id: 'reset', label: 'Quota reset', value: reset }] : [],
    };
  }
}
