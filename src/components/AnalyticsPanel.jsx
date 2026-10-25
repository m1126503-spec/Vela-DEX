// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { fetchHyperliquidAnalytics } from '../lib/hyperliquidAnalytics';

const METRICS = [
  { key: 'tvl', label: 'TVL', source: 'DeFiLlama' },
  { key: 'volume', label: 'DEX Volume', source: 'DeFiLlama' },
  { key: 'fees', label: 'Fees', source: 'DeFiLlama' }
];
const RANGES = [
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'ALL', days: null }
];
const CHART = { width: 900, height: 370, left: 68, right: 20, top: 22, bottom: 44 };

function formatUsd(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: digits
  }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatDate(value, options) {
  return new Date(value).toLocaleDateString('en-US', options);
}

function filterRange(points, days) {
  if (!points.length || !days) return points;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const visible = points.filter((point) => point.date >= cutoff);
  if (visible.length > 1) {
    const prior = points.findLast((point) => point.date < cutoff);
    return prior ? [prior, ...visible] : visible;
  }
  return points.slice(-Math.min(points.length, days));
}

function buildChartGeometry(points) {
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const max = Math.max(...points.map((point) => point.value), 1);
  const pointsWithCoords = points.map((point, index) => ({
    ...point,
    x: CHART.left + (index / Math.max(points.length - 1, 1)) * plotWidth,
    y: CHART.top + plotHeight - (point.value / max) * plotHeight
  }));
  const line = pointsWithCoords.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = pointsWithCoords.length
    ? `${line} L${pointsWithCoords.at(-1).x.toFixed(1)},${(CHART.top + plotHeight).toFixed(1)} L${pointsWithCoords[0].x.toFixed(1)},${(CHART.top + plotHeight).toFixed(1)} Z`
    : '';

  return { plotWidth, plotHeight, max, points: pointsWithCoords, line, area };
}

function AnalyticsChart({ points, metric, range, onRangeChange }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const geometry = useMemo(() => buildChartGeometry(points), [points]);
  const color = metric === 'fees' ? '#ab91ff' : metric === 'volume' ? '#3184ff' : '#3184ff';
  const tooltipPoint = hoverIndex == null ? null : geometry.points[hoverIndex];
  const tickValues = Array.from({ length: 5 }, (_, index) => geometry.max * (4 - index) / 4);
  const dateTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    x: CHART.left + geometry.plotWidth * fraction,
    date: points[Math.round((points.length - 1) * fraction)]?.date
  }));

  function handlePointerMove(event) {
    if (!geometry.points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * CHART.width;
    const plotX = Math.min(CHART.width - CHART.right, Math.max(CHART.left, pointerX));
    const nearest = Math.round(((plotX - CHART.left) / geometry.plotWidth) * (geometry.points.length - 1));
    setHoverIndex(nearest);
  }

  return (
    <section className="analytics-chart-card">
      <div className="analytics-chart-toolbar">
        <div className="analytics-metric-tabs" role="group" aria-label="Метрика графика">
          {METRICS.map((item) => (
            <button key={item.key} type="button" className={metric === item.key ? 'active' : ''} aria-pressed={metric === item.key} onClick={() => { setHoverIndex(null); onRangeChange(item.key, null); }}>
              {item.label}<span> ×</span>
            </button>
          ))}
        </div>
        <div className="analytics-range-tabs" role="group" aria-label="Период графика">
          {RANGES.map((item) => (
            <button key={item.key} type="button" className={range === item.key ? 'active' : ''} aria-pressed={range === item.key} onClick={() => { setHoverIndex(null); onRangeChange(null, item.key); }}>{item.label}</button>
          ))}
        </div>
      </div>

      <div className="analytics-chart-legend">
        <span><i style={{ '--legend-color': color }} />{METRICS.find((item) => item.key === metric)?.label}</span>
        <span>{points.length ? `${points.length.toLocaleString('en-US')} daily points` : 'No chart data'}</span>
      </div>

      <div className="analytics-svg-wrap">
        {points.length > 1 ? (
          <svg
            className="analytics-svg"
            viewBox={`0 0 ${CHART.width} ${CHART.height}`}
            role="img"
            aria-label={`${METRICS.find((item) => item.key === metric)?.label} history chart`}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id="analytics-area-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity=".24" />
                <stop offset="100%" stopColor={color} stopOpacity=".015" />
              </linearGradient>
            </defs>
            {tickValues.map((value, index) => {
              const y = CHART.top + geometry.plotHeight * index / 4;
              return (
                <g key={index}>
                  <line x1={CHART.left} y1={y} x2={CHART.width - CHART.right} y2={y} className="analytics-gridline" />
                  <text x={CHART.left - 12} y={y + 4} textAnchor="end" className="analytics-axis-label">{formatUsd(value, 1)}</text>
                </g>
              );
            })}
            <path d={geometry.area} fill="url(#analytics-area-fill)" />
            <path d={geometry.line} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            {dateTicks.map((tick, index) => tick.date && (
              <text key={index} x={tick.x} y={CHART.height - 12} textAnchor={index === 0 ? 'start' : index === dateTicks.length - 1 ? 'end' : 'middle'} className="analytics-axis-label">
                {formatDate(tick.date, range === '30d' || range === '90d' ? { month: 'short', day: 'numeric' } : { month: 'short', year: '2-digit' })}
              </text>
            ))}
            {tooltipPoint && (
              <g className="analytics-crosshair" pointerEvents="none">
                <line x1={tooltipPoint.x} y1={CHART.top} x2={tooltipPoint.x} y2={CHART.height - CHART.bottom} />
                <circle cx={tooltipPoint.x} cy={tooltipPoint.y} r="5" fill={color} />
              </g>
            )}
          </svg>
        ) : (
          <div className="analytics-chart-empty" role="status">
            {points.length ? 'Для этого периода пока недостаточно точек.' : 'История метрики пока недоступна.'}
          </div>
        )}
        {tooltipPoint && (
          <div className="analytics-tooltip" style={{ left: `${(tooltipPoint.x / CHART.width) * 100}%` }}>
            <strong>{formatUsd(tooltipPoint.value)}</strong>
            <span>{formatDate(tooltipPoint.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
        )}
      </div>
      <div className="analytics-chart-footer">
        <span>Historical data · USD</span>
        <a href="https://defillama.com/protocol/hyperliquid" target="_blank" rel="noreferrer">Explore on DeFiLlama ↗</a>
      </div>
    </section>
  );
}

export default function AnalyticsPanel() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);
  const [metric, setMetric] = useState('tvl');
  const [range, setRange] = useState('1y');

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    fetchHyperliquidAnalytics(fetch, controller.signal)
      .then((data) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch((error) => {
        if (!cancelled && error?.name !== 'AbortError') {
          setSnapshot((previous) => ({
            ...previous,
            errors: [`Не удалось обновить публичные метрики: ${error instanceof Error ? error.message : String(error)}`]
          }));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const refreshTimer = window.setInterval(() => {
      setRefreshCount((value) => value + 1);
    }, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      controller.abort();
    };
  }, [refreshCount]);

  const allPoints = metric === 'tvl'
    ? snapshot?.tvlSeries || []
    : metric === 'fees'
      ? snapshot?.feesSeries || []
      : snapshot?.volumeSeries || [];
  const visiblePoints = useMemo(
    () => filterRange(allPoints, RANGES.find((item) => item.key === range)?.days),
    [allPoints, range]
  );
  const metrics = [
    { label: 'Total Value Locked', value: formatUsd(snapshot?.tvl), detail: 'Protocol TVL' },
    { label: 'Fees · 30d', value: formatUsd(snapshot?.fees30d), detail: 'User fees' },
    { label: 'DEX volume · 30d', value: formatUsd(snapshot?.volume30d), detail: 'Spot + perps DEX activity' },
    { label: 'Open interest', value: formatUsd(snapshot?.openInterest), detail: 'Live perp markets' },
    { label: 'HYPE price', value: snapshot?.hypePrice == null ? '—' : formatUsd(snapshot.hypePrice, 3), detail: snapshot?.hypePriceChange == null ? 'Perp mark · Hyperliquid' : `${formatPercent(snapshot.hypePriceChange)} · 24h` }
  ];

  function changeChart(metricKey, rangeKey) {
    if (metricKey) setMetric(metricKey);
    if (rangeKey) setRange(rangeKey);
  }

  return (
    <main className="analytics-dashboard">
      <div className="analytics-page-heading">
        <div className="analytics-protocol-title">
          <span className="analytics-protocol-mark" aria-hidden="true">H</span>
          <div><small>Protocol analytics · Hyperliquid L1</small><h2>Hyperliquid <span>(HYPE)</span></h2></div>
        </div>
        <div className="analytics-status">
          <span className={loading ? 'analytics-status-dot loading' : 'analytics-status-dot'} />
          {loading ? 'Updating data' : snapshot?.updatedAt ? `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString('en-US')}` : 'Waiting for data'}
          <button type="button" className="analytics-refresh" disabled={loading} onClick={() => setRefreshCount((value) => value + 1)} aria-label="Refresh analytics">↻</button>
        </div>
      </div>

      <div className="analytics-summary-grid">
        <section className="analytics-key-card">
          <div className="analytics-card-label">Total Value Locked <span>ⓘ</span></div>
          <strong className="analytics-tvl-value">{formatUsd(snapshot?.tvl)}</strong>
          <div className="analytics-key-heading"><strong>Key metrics</strong><small>PUBLIC DATA</small></div>
          {metrics.map((item) => (
            <div className="analytics-key-row" key={item.label}>
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              <b>{item.value}</b>
            </div>
          ))}
          <div className="analytics-sources">
            <span>Sources</span><a href="https://defillama.com/protocol/hyperliquid" target="_blank" rel="noreferrer">DeFiLlama</a><a href="https://app.hyperliquid.xyz/" target="_blank" rel="noreferrer">Hyperliquid</a>
          </div>
        </section>

        <div className="analytics-chart-column">
          <div className="analytics-chart-summary">
            {metrics.slice(1, 4).map((item) => (
              <div className="analytics-stat-card" key={item.label}>
                <span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small>
              </div>
            ))}
          </div>
          <AnalyticsChart
            points={visiblePoints}
            metric={metric}
            range={range}
            onRangeChange={changeChart}
          />
          {snapshot?.errors?.length > 0 && (
            <div className="analytics-data-warning" role="status">
              <strong>Some sources are unavailable.</strong>
              <span>{snapshot.errors.join(' · ')}</span>
            </div>
          )}
        </div>
      </div>
      <footer className="analytics-footer">
        <span>Independent analytics · Not investment advice</span>
        <span>TVL, fees and DEX volume are reported by DeFiLlama; open interest and HYPE mark price use Hyperliquid perp market contexts.</span>
      </footer>
    </main>
  );
}
