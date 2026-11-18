// For tests only: run a component's hooks with no DOM renderer (these tests have none).

import * as React from 'react';

/**
 * A hook harness: a component called as a function, its state kept here (no DOM in these tests). React 19's hook
 * dispatcher is set for the call, the same path React itself takes, so the component's own handlers run; effects don't.
 */
export function hookHarness(contexts: Map<unknown, unknown> = new Map()) {
  const slots: unknown[] = [];
  let i = 0;
  const internals = (React as unknown as Record<string, { H: unknown }>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const useState = (init: unknown) => {
    const k = i++;
    if (!(k in slots)) slots[k] = typeof init === 'function' ? (init as () => unknown)() : init;
    return [slots[k], (v: unknown) => (slots[k] = typeof v === 'function' ? (v as (x: unknown) => unknown)(slots[k]) : v)];
  };
  const useRef = (init: unknown) => {
    const k = i++;
    if (!(k in slots)) slots[k] = { current: init };
    return slots[k];
  };
  const useMemo = (f: () => unknown, deps: unknown[]) => {
    const k = i++;
    const had = slots[k] as { v: unknown; deps: unknown[] } | undefined;
    if (!had || had.deps.length !== deps.length || deps.some((d, j) => !Object.is(d, had.deps[j]))) slots[k] = { v: f(), deps };
    return (slots[k] as { v: unknown }).v;
  };
  const render = <T,>(f: () => T): T => {
    i = 0;
    const prev = internals.H;
    // (A context reads the value given here for it, else its default: no providers without a renderer.)
    const useContext = (c: { _currentValue?: unknown }) => (contexts.has(c) ? contexts.get(c) : c._currentValue);
    internals.H = { useState, useRef, useMemo, useContext, useEffect: () => {}, useLayoutEffect: () => {} };
    try {
      return f();
    } finally {
      internals.H = prev;
    }
  };
  return { render };
}
