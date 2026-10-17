import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';

// Screens import charts from here so the chart code is a separate chunk loaded on demand (AC-99, AC-106.4).
// The fallback holds the chart's height, so nothing jumps when it arrives (AC-91 CLS).
function lazyChart<P extends { height?: number }>(load: () => Promise<{ default: ComponentType<P> }>, fallback = 160) {
  const C = lazy(load) as LazyExoticComponent<ComponentType<P>>;
  return (p: P) => (
    <Suspense fallback={<div className="chart-body" style={{ minHeight: p.height ?? fallback }} />}>
      <C {...p} />
    </Suspense>
  );
}

export const StackedBars = lazyChart<Parameters<typeof import('./StackedBars').default>[0]>(() => import('./StackedBars'));
export const HBars = lazyChart<Parameters<typeof import('./HBars').default>[0]>(() => import('./HBars'));
export const Line = lazyChart<Parameters<typeof import('./Line').default>[0]>(() => import('./Line'));
export const Sparkline = lazyChart<Parameters<typeof import('./Sparkline').default>[0]>(() => import('./Sparkline'), 64);
export const Kpi = lazyChart<Parameters<typeof import('./Kpi').default>[0]>(() => import('./Kpi'), 96);
export const Segments = lazyChart<Parameters<typeof import('./Segments').default>[0]>(() => import('./Segments'), 48);
