import { PlanUsageController } from './plan-usage.controller';

describe('PlanUsageController', () => {
  it('returns an empty result before a tenant exists', async () => {
    const service = { getUsage: jest.fn() };
    const controller = new PlanUsageController(service as never);

    const result = await controller.getUsage({ tenantId: null, userId: 'user-1' });

    expect(result.connections).toEqual([]);
    expect(service.getUsage).not.toHaveBeenCalled();
  });

  it('passes tenant and refresh flag to the service', async () => {
    const response = { fetchedAt: '2026-09-02T00:00:00Z', connections: [] };
    const service = { getUsage: jest.fn().mockResolvedValue(response) };
    const controller = new PlanUsageController(service as never);

    await expect(
      controller.getUsage({ tenantId: 'tenant-1', userId: 'user-1' }, 'true'),
    ).resolves.toBe(response);
    expect(service.getUsage).toHaveBeenCalledWith('tenant-1', true);
  });
});
