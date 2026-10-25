import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHyperliquidAnalyticsSnapshot,
  fetchHyperliquidAnalytics
} from '../src/lib/hyperliquidAnalytics.js';

const fulfilled = (value) => ({ status: 'fulfilled', value });
const rejected = (message) => ({ status: 'rejected', reason: new Error(message) });

test('normalizes live TVL, fee, DEX-volume, open-interest, and price data', () => {
  const snapshot = buildHyperliquidAnalyticsSnapshot({
    tvl: fulfilled({
      tvl: [
        { date: 1_700_000_000, totalLiquidityUSD: 900 },
        { date: 1_700_086_400, totalLiquidityUSD: '1200' }
      ]
    }),
    fees: fulfilled({
      totalDataChart: [[1_700_086_400, 25], [1_700_000_000, 20]],
      total24h: 25,
      total30d: 500
    }),
    volume: fulfilled({
      totalDataChart: [[1_700_086_400, 400]],
      total24h: 400,
      total30d: 10_000
    }),
    openInterest: fulfilled([{ universe: [{ name: 'BTC' }, { name: 'HYPE' }, { name: 'ETH' }] }, [
      { openInterest: '2.5', markPx: '100' },
      { openInterest: '3', markPx: '50', prevDayPx: '40' },
      { openInterest: 'invalid', markPx: '50' }
    ]]),
  }, 1_700_100_000);

  assert.equal(snapshot.tvl, 1200);
  assert.deepEqual(snapshot.tvlSeries.map((point) => point.value), [900, 1200]);
  assert.deepEqual(snapshot.feesSeries.map((point) => point.value), [20, 25]);
  assert.equal(snapshot.fees24h, 25);
  assert.equal(snapshot.fees30d, 500);
  assert.equal(snapshot.volume30d, 10_000);
  assert.equal(snapshot.openInterest, 400);
  assert.equal(snapshot.hypePrice, 50);
  assert.equal(snapshot.hypePriceChange, 25);
  assert.equal(snapshot.errors.length, 0);
});

test('keeps good source data and reports unavailable or malformed sources', () => {
  const snapshot = buildHyperliquidAnalyticsSnapshot({
    tvl: fulfilled({ tvl: [{ date: 1_700_000_000, totalLiquidityUSD: 100 }] }),
    fees: rejected('rate limited'),
    volume: fulfilled({ totalDataChart: [] }),
    openInterest: fulfilled({ unexpected: true }),
  });

  assert.equal(snapshot.tvl, 100);
  assert.equal(snapshot.fees30d, null);
  assert.equal(snapshot.openInterest, null);
  assert.equal(snapshot.errors.length, 3);
  assert.match(snapshot.errors.join(' '), /rate limited/);
});

test('fetches only public read endpoints and normalizes the returned snapshots', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const body = String(url).includes('/protocol/')
      ? { tvl: [{ date: 1_700_000_000, totalLiquidityUSD: 250 }] }
      : String(url).includes('/summary/fees/')
        ? { totalDataChart: [[1_700_000_000, 10]], total24h: 10, total30d: 300 }
        : String(url).includes('/summary/dexs/')
          ? { totalDataChart: [[1_700_000_000, 80]], total24h: 80, total30d: 2400 }
          : [{ universe: [{ name: 'HYPE' }] }, [{ openInterest: '1', markPx: '10', prevDayPx: '8' }]];
    return { ok: true, json: async () => body };
  };

  const snapshot = await fetchHyperliquidAnalytics(fetchImpl);

  assert.equal(snapshot.tvl, 250);
  assert.equal(snapshot.fees30d, 300);
  assert.equal(snapshot.volume30d, 2400);
  assert.equal(snapshot.openInterest, 10);
  assert.equal(snapshot.hypePrice, 10);
  assert.equal(snapshot.hypePriceChange, 25);
  assert.equal(requests.length, 4);
  assert.equal(requests.find((request) => request.url.endsWith('/info')).options.method, 'POST');
  assert.ok(requests.every((request) => request.options.method !== 'PUT' && request.options.method !== 'DELETE'));
});
