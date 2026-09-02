import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPlanUsage = vi.fn();

vi.mock('@solidjs/meta', () => ({ Title: () => null }));
vi.mock('../../src/components/ProviderIcon.jsx', () => ({ providerIcon: () => null }));
vi.mock('../../src/services/api.js', () => ({
  getPlanUsage: (...args: unknown[]) => getPlanUsage(...args),
}));

import PlanUsage from '../../src/pages/PlanUsage';

beforeEach(() => {
  getPlanUsage.mockResolvedValue({
    fetchedAt: '2026-09-02T00:00:00Z',
    connections: [
      {
        connectionId: 'anthropic-1',
        providerId: 'anthropic',
        displayName: 'Claude',
        label: 'Default',
        status: 'available',
        planLabel: 'Max',
        windows: [
          { id: 'five_hour', label: '5-hour', usedPct: 25, remainingPct: 75, resetsAt: null },
          { id: 'weekly', label: 'Weekly', usedPct: 40, remainingPct: 60, resetsAt: null },
          { id: 'fable', label: 'Weekly · Fable', usedPct: 10, remainingPct: 90, resetsAt: null },
        ],
        balances: [],
        details: [],
        message: null,
      },
      {
        connectionId: 'gemini-1',
        providerId: 'gemini',
        displayName: 'Gemini',
        label: 'Work',
        status: 'unavailable',
        planLabel: null,
        windows: [],
        balances: [],
        details: [],
        message: 'This provider does not expose plan usage through its subscription API.',
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PlanUsage', () => {
  it('renders all subscriptions and remaining quota bars', async () => {
    render(() => <PlanUsage />);

    await waitFor(() => expect(screen.getByText('Claude')).toBeDefined());
    expect(screen.getByText('75% remaining')).toBeDefined();
    expect(screen.getByText('60% remaining')).toBeDefined();
    expect(screen.getByText('90% remaining')).toBeDefined();
    expect(screen.getByText('Gemini')).toBeDefined();
    expect(screen.getByText(/does not expose plan usage/)).toBeDefined();
  });

  it('refreshes usage from the button', async () => {
    render(() => <PlanUsage />);
    await waitFor(() => expect(screen.getByText('Claude')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(getPlanUsage).toHaveBeenCalledTimes(2));
    expect(getPlanUsage).toHaveBeenLastCalledWith(true);
  });
});
