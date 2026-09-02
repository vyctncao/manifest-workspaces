import { createSignal } from 'solid-js';
import { invalidateCustomProvidersCache } from './api/routing.js';
import { invalidateGroup } from './api/cache.js';
import { isDocumentHidden, onDocumentVisible } from './document-visibility.js';

// pingCount counts ANY event from the bus (legacy back-compat for callers that
// don't care which kind fired). New code should depend on the targeted
// signals so a routing-only change doesn't refetch the message log etc.
const [pingCount, setPingCount] = createSignal(0);
const [messagePing, setMessagePing] = createSignal(0);
const [agentPing, setAgentPing] = createSignal(0);
const [routingPing, setRoutingPing] = createSignal(0);

export { pingCount, messagePing, agentPing, routingPing };

/** Refresh views derived from the harness list after a local mutation. */
export function refreshAgents(): void {
  invalidateGroup('agent');
  setAgentPing((n) => n + 1);
}

export function connectSse(): () => void {
  const es = new EventSource('/api/v1/events');

  const bumpPing = () => setPingCount((n) => n + 1);

  // Coalesce message-class bumps. A chatty agent emits one SSE `message` event
  // per ingested record, and every bump refetches the Overview/MessageLog
  // resources. Collapsing a burst into a single bump every 500ms keeps backend
  // QPS sane at the cost of a small refresh delay on the dashboard.
  let messageBumpTimer: ReturnType<typeof setTimeout> | null = null;

  // Invalidate the SWR cache BEFORE bumping the ping. The ping drives the
  // resource refetch; if the stale message/overview/usage entries were still
  // cached, that refetch would read them and the dashboard wouldn't update
  // live. Dropping them first guarantees the refetch hits the network.
  const flushMessageBump = () => {
    invalidateGroup('message');
    setMessagePing((n) => n + 1);
  };

  // Set while events arrive with the tab hidden, so the catch-up bump on return
  // happens only if something actually changed.
  let missedWhileHidden = false;

  const bumpMessagePing = () => {
    // A hidden tab has nothing to repaint, so the 500ms window would just run
    // the dashboard's entire resource fan-out twice a second behind a
    // background tab for as long as an agent keeps streaming. Defer instead of
    // dropping: record that something moved and settle up in a single bump when
    // the tab comes back, so a returning user still sees current data.
    if (isDocumentHidden()) {
      missedWhileHidden = true;
      return;
    }
    if (messageBumpTimer) return;
    messageBumpTimer = setTimeout(() => {
      messageBumpTimer = null;
      flushMessageBump();
    }, 500);
  };

  const stopVisibilityWatch = onDocumentVisible(() => {
    if (!missedWhileHidden) return;
    missedWhileHidden = false;
    flushMessageBump();
  });

  // Legacy generic 'ping' from older deployments — keep listening so a partial
  // upgrade (old backend, new frontend) still triggers refetches. The safe
  // default is to treat unknown 'ping' as a message-class change since that's
  // the kind the bus emitted before typed events landed.
  es.addEventListener('ping', () => {
    bumpMessagePing();
    bumpPing();
  });

  es.addEventListener('message', () => {
    bumpMessagePing();
    bumpPing();
  });
  es.addEventListener('agent', () => {
    // Drop agent-list/per-agent GET cache before the agentPing refetch reads it.
    refreshAgents();
    bumpPing();
  });
  es.addEventListener('routing', () => {
    // Custom providers are user-global; a routing change (incl. a custom-provider
    // create/update/delete on any agent) can change every agent's list, so drop
    // the cached lists before the routingPing-driven refetch reads them. Order
    // matters: invalidate the SWR cache (and the custom-providers cache) BEFORE
    // bumping routingPing so the refetch reads fresh routing/provider data.
    invalidateGroup('routing');
    invalidateCustomProvidersCache();
    setRoutingPing((n) => n + 1);
    bumpPing();
  });

  return () => {
    if (messageBumpTimer) clearTimeout(messageBumpTimer);
    messageBumpTimer = null;
    missedWhileHidden = false;
    stopVisibilityWatch();
    es.close();
  };
}
