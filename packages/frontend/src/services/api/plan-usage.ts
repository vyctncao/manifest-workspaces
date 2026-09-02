import { fetchJson } from './core.js';

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

export function getPlanUsage(refresh = false): Promise<PlanUsageResponse> {
  return fetchJson<PlanUsageResponse>(
    '/routing/plan-usage',
    refresh ? { refresh: 'true' } : undefined,
    {
      cache: false,
    },
  );
}
