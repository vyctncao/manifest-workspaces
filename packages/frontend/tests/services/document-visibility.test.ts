import { describe, it, expect, vi, afterEach } from 'vitest';
import { isDocumentHidden, onDocumentVisible } from '../../src/services/document-visibility';

/** Drive document.visibilityState and capture visibilitychange listeners. */
function stubDocument(initial: 'visible' | 'hidden') {
  let state = initial;
  const listeners: Array<() => void> = [];
  vi.stubGlobal('document', {
    get visibilityState() {
      return state;
    },
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'visibilitychange') listeners.push(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  });
  return {
    set(next: 'visible' | 'hidden') {
      state = next;
      for (const fn of [...listeners]) fn();
    },
    listenerCount: () => listeners.length,
  };
}

describe('document-visibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports hidden state', () => {
    stubDocument('hidden');
    expect(isDocumentHidden()).toBe(true);
  });

  it('reports visible state', () => {
    stubDocument('visible');
    expect(isDocumentHidden()).toBe(false);
  });

  it('treats a document-less environment as visible', () => {
    // SSR and non-DOM unit tests have no document. Reporting "hidden" there
    // would silently suppress work that has no tab to be hidden behind.
    vi.stubGlobal('document', undefined);
    expect(isDocumentHidden()).toBe(false);
  });

  it('runs the handler only on transitions to visible', () => {
    const doc = stubDocument('hidden');
    const handler = vi.fn();
    onDocumentVisible(handler);

    doc.set('hidden');
    expect(handler).not.toHaveBeenCalled();

    doc.set('visible');
    expect(handler).toHaveBeenCalledTimes(1);

    doc.set('hidden');
    doc.set('visible');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes cleanly', () => {
    const doc = stubDocument('hidden');
    const handler = vi.fn();
    const stop = onDocumentVisible(handler);

    stop();
    expect(doc.listenerCount()).toBe(0);

    doc.set('visible');
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns a no-op unsubscribe without a document', () => {
    vi.stubGlobal('document', undefined);
    const stop = onDocumentVisible(vi.fn());
    expect(() => stop()).not.toThrow();
  });
});
