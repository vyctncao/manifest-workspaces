import { PlanUsageService } from './plan-usage.service';
import { decrypt } from '../../common/utils/crypto.util';

jest.mock('../../common/utils/crypto.util', () => ({
  decrypt: jest.fn(),
  getEncryptionSecret: jest.fn().mockReturnValue('secret'),
}));

const mockDecrypt = decrypt as jest.MockedFunction<typeof decrypt>;

function provider(provider: string, id = provider) {
  return {
    id,
    tenant_id: 'tenant-1',
    provider,
    auth_type: 'subscription',
    api_key_encrypted: 'encrypted',
    label: 'Default',
    priority: 0,
    is_active: true,
    region: null,
  };
}

describe('PlanUsageService', () => {
  const originalFetch = global.fetch;
  let repo: { find: jest.Mock };
  let service: PlanUsageService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = { find: jest.fn() };
    service = new PlanUsageService(repo as never);
    mockDecrypt.mockReturnValue('token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps Claude five-hour, weekly, Opus, and Fable windows', async () => {
    repo.find.mockResolvedValue([provider('anthropic')]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        five_hour: { utilization: 20, resets_at: '2026-09-02T05:00:00Z' },
        seven_day: { utilization: 30, resets_at: '2026-09-07T00:00:00Z' },
        seven_day_opus: { utilization: 40, resets_at: '2026-09-07T00:00:00Z' },
        seven_day_omelette: { utilization: 50, resets_at: '2026-09-07T00:00:00Z' },
      }),
    }) as jest.MockedFunction<typeof fetch>;

    const result = await service.getUsage('tenant-1');

    expect(result.connections[0].windows).toEqual([
      expect.objectContaining({ label: '5-hour', remainingPct: 80 }),
      expect.objectContaining({ label: 'Weekly', remainingPct: 70 }),
      expect.objectContaining({ label: 'Weekly · Opus', remainingPct: 60 }),
      expect.objectContaining({ label: 'Weekly · Fable', remainingPct: 50 }),
    ]);
  });

  it('returns every subscription and marks unsupported usage APIs unavailable', async () => {
    repo.find.mockResolvedValue([provider('gemini'), provider('qwen')]);

    const result = await service.getUsage('tenant-1');

    expect(result.connections).toHaveLength(2);
    expect(result.connections.every((connection) => connection.status === 'unavailable')).toBe(
      true,
    );
  });

  it('maps Codex primary and secondary windows', async () => {
    repo.find.mockResolvedValue([provider('openai')]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rate_limit: {
          primary_window: {
            used_percent: 25,
            reset_at: 1788339600,
            limit_window_seconds: 5 * 60 * 60,
          },
          secondary_window: {
            used_percent: 75,
            reset_at: 1788944400,
            limit_window_seconds: 7 * 24 * 60 * 60,
          },
        },
      }),
    }) as jest.MockedFunction<typeof fetch>;

    const result = await service.getUsage('tenant-1');

    expect(result.connections[0].windows).toEqual([
      expect.objectContaining({ label: '5-hour', remainingPct: 75 }),
      expect.objectContaining({ label: 'Weekly', remainingPct: 25 }),
    ]);
  });

  it('uses the reported Codex duration instead of assuming the primary window is five hours', async () => {
    repo.find.mockResolvedValue([provider('openai')]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rate_limit: {
          primary_window: {
            used_percent: 17,
            reset_at: 1788749940,
            limit_window_seconds: 7 * 24 * 60 * 60,
          },
        },
      }),
    }) as jest.MockedFunction<typeof fetch>;

    const result = await service.getUsage('tenant-1');

    expect(result.connections[0].windows).toEqual([
      expect.objectContaining({ label: 'Weekly', remainingPct: 83 }),
    ]);
  });

  it('recognizes a weekly Codex reset when the API omits its window duration', async () => {
    repo.find.mockResolvedValue([provider('openai')]);
    const resetAt = Math.floor(Date.now() / 1000) + 4 * 24 * 60 * 60;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rate_limit: { primary_window: { used_percent: 91, reset_at: resetAt } },
      }),
    }) as jest.MockedFunction<typeof fetch>;

    const result = await service.getUsage('tenant-1');

    expect(result.connections[0].windows).toEqual([
      expect.objectContaining({ label: 'Weekly', remainingPct: 9 }),
    ]);
  });

  it('maps Grok unified billing to its weekly subscription window', async () => {
    repo.find.mockResolvedValue([provider('xai')]);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          config: {
            currentPeriod: {
              type: 'USAGE_PERIOD_TYPE_WEEKLY',
              start: '2026-08-29T02:36:25.134131+00:00',
              end: '2026-09-05T02:36:25.134131+00:00',
            },
            creditUsagePercent: 9,
            prepaidBalance: { val: 0 },
            billingPeriodEnd: '2026-09-05T02:36:25.134131+00:00',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscription_tier_display: 'SuperGrok Plus' }),
      }) as jest.MockedFunction<typeof fetch>;

    const result = await service.getUsage('tenant-1');
    const connection = result.connections[0];

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-XAI-Token-Auth': 'xai-grok-cli' }),
      }),
    );
    expect(connection.planLabel).toBe('SuperGrok Plus');
    expect(connection.windows).toEqual([
      expect.objectContaining({
        label: 'Weekly limit',
        usedPct: 9,
        remainingPct: 91,
        resetsAt: '2026-09-05T02:36:25.134131+00:00',
      }),
    ]);
    expect(connection.balances).toEqual([]);
    expect(connection.status).toBe('available');
  });

  it('keeps Grok usage available when the optional plan-label request fails', async () => {
    repo.find.mockResolvedValue([provider('xai')]);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          config: {
            currentPeriod: {
              type: 'USAGE_PERIOD_TYPE_WEEKLY',
              end: '2026-09-05T02:36:25.134131+00:00',
            },
            creditUsagePercent: 9,
          },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503 }) as jest.MockedFunction<typeof fetch>;

    const result = await service.getUsage('tenant-1');
    const connection = result.connections[0];

    expect(connection.planLabel).toBeNull();
    expect(connection.windows).toEqual([
      expect.objectContaining({ label: 'Weekly limit', remainingPct: 91 }),
    ]);
    expect(connection.status).toBe('available');
  });

  it('does not present the legacy zero Grok credit ledger as available usage', async () => {
    repo.find.mockResolvedValue([provider('xai')]);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          config: {
            monthlyLimit: { val: 0 },
            used: { val: 0 },
            billingPeriodEnd: '2026-10-01T00:00:00+00:00',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscription_tier_display: 'SuperGrok Plus' }),
      }) as jest.MockedFunction<typeof fetch>;

    const result = await service.getUsage('tenant-1');
    const connection = result.connections[0];

    expect(connection.windows).toEqual([]);
    expect(connection.balances).toEqual([]);
    expect(connection.status).toBe('unavailable');
  });

  it('caches usage briefly unless refresh is requested', async () => {
    repo.find.mockResolvedValue([provider('gemini')]);

    await service.getUsage('tenant-1');
    await service.getUsage('tenant-1');
    await service.getUsage('tenant-1', true);

    expect(repo.find).toHaveBeenCalledTimes(2);
  });
});
