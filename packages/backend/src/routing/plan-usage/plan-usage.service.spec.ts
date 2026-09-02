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
          primary_window: { used_percent: 25, reset_at: 1788339600 },
          secondary_window: { used_percent: 75, reset_at: 1788944400 },
        },
      }),
    }) as jest.MockedFunction<typeof fetch>;

    const result = await service.getUsage('tenant-1');

    expect(result.connections[0].windows).toEqual([
      expect.objectContaining({ label: '5-hour', remainingPct: 75 }),
      expect.objectContaining({ label: 'Weekly', remainingPct: 25 }),
    ]);
  });

  it('caches usage briefly unless refresh is requested', async () => {
    repo.find.mockResolvedValue([provider('gemini')]);

    await service.getUsage('tenant-1');
    await service.getUsage('tenant-1');
    await service.getUsage('tenant-1', true);

    expect(repo.find).toHaveBeenCalledTimes(2);
  });
});
