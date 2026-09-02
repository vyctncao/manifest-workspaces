import { Title } from '@solidjs/meta';
import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { getPlanUsage, type PlanUsageConnection } from '../services/api.js';
import { providerIcon } from '../components/ProviderIcon.jsx';
import '../styles/plan-usage.css';

function formatReset(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const ProviderCard: Component<{ connection: PlanUsageConnection }> = (props) => (
  <article class="plan-usage-card">
    <header class="plan-usage-card__header">
      <span class="plan-usage-card__icon">{providerIcon(props.connection.providerId, 28)}</span>
      <div>
        <h2>{props.connection.displayName}</h2>
        <p>
          {props.connection.label}
          <Show when={props.connection.planLabel}> · {props.connection.planLabel}</Show>
        </p>
      </div>
      <span class={`plan-usage-card__status plan-usage-card__status--${props.connection.status}`}>
        {props.connection.status}
      </span>
    </header>

    <Show
      when={props.connection.windows.length || props.connection.balances.length}
      fallback={
        <p class="plan-usage-card__empty">
          {props.connection.message ?? 'The provider did not report a numeric usage limit.'}
        </p>
      }
    >
      <div class="plan-usage-windows">
        <For each={props.connection.windows}>
          {(window) => (
            <section class="plan-usage-window">
              <div class="plan-usage-window__heading">
                <span>{window.label}</span>
                <strong>
                  {window.remainingPct === null
                    ? 'Unavailable'
                    : `${Math.round(window.remainingPct)}% remaining`}
                </strong>
              </div>
              <div
                class="plan-usage-window__track"
                role="progressbar"
                aria-label={window.label}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={window.remainingPct ?? undefined}
              >
                <div
                  class="plan-usage-window__fill"
                  classList={{
                    'plan-usage-window__fill--warning': (window.remainingPct ?? 100) <= 30,
                    'plan-usage-window__fill--danger': (window.remainingPct ?? 100) <= 10,
                  }}
                  style={{ width: `${window.remainingPct ?? 0}%` }}
                />
              </div>
              <Show when={formatReset(window.resetsAt)}>
                {(reset) => <small>Resets {reset()}</small>}
              </Show>
            </section>
          )}
        </For>
        <For each={props.connection.balances}>
          {(balance) => (
            <section class="plan-usage-window">
              <div class="plan-usage-window__heading">
                <span>{balance.label}</span>
                <strong>
                  {balance.remaining === null
                    ? balance.used === null
                      ? 'Unavailable'
                      : `${balance.used.toLocaleString()} ${balance.unit} used`
                    : `${balance.remaining.toLocaleString()} ${balance.unit} remaining`}
                </strong>
              </div>
              <Show
                when={balance.limit !== null && balance.limit > 0 && balance.remaining !== null}
              >
                <div class="plan-usage-window__track">
                  <div
                    class="plan-usage-window__fill"
                    style={{
                      width: `${Math.max(0, Math.min(100, (balance.remaining! / balance.limit!) * 100))}%`,
                    }}
                  />
                </div>
              </Show>
              <Show when={formatReset(balance.resetsAt)}>
                {(reset) => <small>Resets {reset()}</small>}
              </Show>
            </section>
          )}
        </For>
      </div>
    </Show>

    <Show when={props.connection.details.length}>
      <dl class="plan-usage-card__details">
        <For each={props.connection.details}>
          {(detail) => (
            <div>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          )}
        </For>
      </dl>
    </Show>
  </article>
);

const PlanUsage: Component = () => {
  const [refreshKey, setRefreshKey] = createSignal(1);
  const [usage] = createResource(refreshKey, (key) => getPlanUsage(key > 1));

  return (
    <main class="plan-usage-page">
      <Title>Plan usage | Manifest</Title>
      <header class="plan-usage-page__header">
        <div>
          <h1>Plan usage</h1>
          <p>Remaining quota across all active subscription connections.</p>
        </div>
        <button
          class="plan-usage-page__refresh"
          disabled={usage.loading}
          onClick={() => setRefreshKey((key) => key + 1)}
        >
          {usage.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <Show when={usage.error}>
        <div class="plan-usage-page__error">Could not load subscription usage.</div>
      </Show>
      <Show when={!usage.loading && usage()?.connections.length === 0}>
        <div class="plan-usage-page__empty">No active subscriptions are connected.</div>
      </Show>
      <div class="plan-usage-grid">
        <For each={usage()?.connections ?? []}>
          {(connection) => <ProviderCard connection={connection} />}
        </For>
      </div>
      <Show when={usage()?.fetchedAt}>
        <p class="plan-usage-page__updated">
          Updated {new Date(usage()!.fetchedAt).toLocaleString()}
        </p>
      </Show>
    </main>
  );
};

export default PlanUsage;
