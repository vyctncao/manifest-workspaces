/**
 * Document-visibility helpers used to stop background tabs doing work.
 *
 * A hidden tab has nothing to repaint, so any refetch it performs is pure
 * waste — but the dashboard's live surfaces are all driven by SSE pings and
 * interval polls that keep firing regardless. Left ungated, a dashboard sitting
 * in a background tab runs its whole resource fan-out for as long as an agent
 * is streaming, forever.
 *
 * The contract these helpers exist to support is *defer, never drop*: work that
 * would have happened while hidden is collapsed into a single catch-up when the
 * tab comes back, so returning to a stale tab still shows current data.
 */

/** True when the document is currently hidden (background tab, minimised window). */
export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Run `handler` each time the document becomes visible.
 *
 * @returns An unsubscribe function. Safe to call in non-DOM environments (SSR,
 *          unit tests without a document), where it is a no-op.
 */
export function onDocumentVisible(handler: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const listener = (): void => {
    if (document.visibilityState === 'visible') handler();
  };
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}
