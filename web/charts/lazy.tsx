import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import './charts.css'; // the placeholders use the real tiles' classes, so the styles must be here before the chart chunk arrives

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
const KpiTile = lazy(() => import('./Kpi'));
/** The placeholder is the real tile with no value: same class (so the same padding at every width), label and hint, same min-height (AC-91 CLS, AC-99). */
export function Kpi(p: Parameters<typeof import('./Kpi').default>[0]) {
  const height = p.height ?? 96;
  return (
    <Suspense fallback={(
      <div className="chart-kpi" aria-hidden style={{ minHeight: height }}>
        <span className="chart-kpi-label">{p.label}</span>
        <b className="chart-kpi-value">&nbsp;</b>
        {p.hint && <span className="chart-kpi-hint">{p.hint}</span>}
      </div>
    )}>
      <KpiTile {...p} height={height} />
    </Suspense>
  );
}
export const Segments = lazyChart<Parameters<typeof import('./Segments').default>[0]>(() => import('./Segments'), 48);
