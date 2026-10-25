const LLAMA_API = 'https://api.llama.fi';
const HYPERLIQUID_INFO_API = 'https://api.hyperliquid.xyz/info';

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function parseSeriesRows(rows, timestampKey, valueKey) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const timestamp = finiteNumber(row?.[timestampKey]);
    const value = finiteNumber(row?.[valueKey]);
    if (timestamp == null || timestamp <= 0 || value == null || value < 0) return [];
    return [{ date: timestamp > 10_000_000_000 ? timestamp : timestamp * 1000, value }];
  }).sort((a, b) => a.date - b.date);
}

function parseSummarySeries(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 2) return [];
    const timestamp = finiteNumber(row[0]);
    const value = finiteNumber(row[1]);
    if (timestamp == null || timestamp <= 0 || value == null || value < 0) return [];
    return [{ date: timestamp > 10_000_000_000 ? timestamp : timestamp * 1000, value }];
  }).sort((a, b) => a.date - b.date);
}

async function fetchJson(url, fetchImpl, signal, options) {
  const response = await fetchImpl(url, { ...options, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function addSettledSource(name, result, extract, values, errors) {
  if (result.status === 'rejected') {
    errors.push(`${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    return;
  }
  try {
    extract(result.value, values);
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function buildHyperliquidAnalyticsSnapshot(results, updatedAt = Date.now()) {
  const values = {
    tvlSeries: [],
    feesSeries: [],
    volumeSeries: [],
    tvl: null,
    fees24h: null,
    fees30d: null,
    volume24h: null,
    volume30d: null,
    openInterest: null,
    hypePrice: null,
    hypePriceChange: null,
    updatedAt
  };
  const errors = [];

  addSettledSource('TVL · DeFiLlama', results.tvl, (data, snapshot) => {
    if (!data || !Array.isArray(data.tvl)) throw new Error('Неверный формат истории TVL.');
    snapshot.tvlSeries = parseSeriesRows(data.tvl, 'date', 'totalLiquidityUSD');
    snapshot.tvl = snapshot.tvlSeries.at(-1)?.value ?? null;
    if (!snapshot.tvlSeries.length) throw new Error('История TVL пуста.');
  }, values, errors);

  addSettledSource('Комиссии · DeFiLlama', results.fees, (data, snapshot) => {
    if (!data || !Array.isArray(data.totalDataChart)) throw new Error('Неверный формат истории комиссий.');
    snapshot.feesSeries = parseSummarySeries(data.totalDataChart);
    if (!snapshot.feesSeries.length) throw new Error('История комиссий пуста.');
    snapshot.fees24h = finiteNumber(data.total24h);
    snapshot.fees30d = finiteNumber(data.total30d);
  }, values, errors);

  addSettledSource('Объем DEX · DeFiLlama', results.volume, (data, snapshot) => {
    if (!data || !Array.isArray(data.totalDataChart)) throw new Error('Неверный формат истории объема.');
    snapshot.volumeSeries = parseSummarySeries(data.totalDataChart);
    if (!snapshot.volumeSeries.length) throw new Error('История объема пуста.');
    snapshot.volume24h = finiteNumber(data.total24h);
    snapshot.volume30d = finiteNumber(data.total30d);
  }, values, errors);

  addSettledSource('Open interest · Hyperliquid', results.openInterest, (data, snapshot) => {
    const universe = Array.isArray(data?.[0]?.universe) ? data[0].universe : null;
    const contexts = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : null;
    if (!universe || !contexts || universe.length !== contexts.length) {
      throw new Error('Неверный формат контекстов рынков.');
    }
    let validContexts = 0;
    const total = contexts.reduce((sum, context) => {
      const openInterest = finiteNumber(context?.openInterest);
      const markPrice = finiteNumber(context?.markPx);
      if (openInterest == null || markPrice == null) return sum;
      validContexts += 1;
      return sum + openInterest * markPrice;
    }, 0);
    snapshot.openInterest = validContexts ? total : null;
    if (!validContexts) errors.push('Open interest · Hyperliquid: нет валидных рыночных данных.');
    const hypeIndex = universe.findIndex((asset) => asset?.name === 'HYPE');
    const hypeContext = hypeIndex >= 0 ? contexts[hypeIndex] : null;
    snapshot.hypePrice = finiteNumber(hypeContext?.markPx);
    const previousPrice = finiteNumber(hypeContext?.prevDayPx);
    snapshot.hypePriceChange = snapshot.hypePrice != null && previousPrice != null && previousPrice > 0
      ? ((snapshot.hypePrice / previousPrice) - 1) * 100
      : null;
    if (snapshot.hypePrice == null) errors.push('Цена HYPE · Hyperliquid: цена perpetual mark недоступна.');
  }, values, errors);

  return { ...values, errors };
}

export async function fetchHyperliquidAnalytics(fetchImpl = fetch, signal) {
  const requests = {
    tvl: fetchJson(`${LLAMA_API}/protocol/hyperliquid`, fetchImpl, signal),
    fees: fetchJson(`${LLAMA_API}/summary/fees/hyperliquid?dataType=dailyFees`, fetchImpl, signal),
    volume: fetchJson(`${LLAMA_API}/summary/dexs/hyperliquid?dataType=dailyVolume`, fetchImpl, signal),
    openInterest: fetchJson(HYPERLIQUID_INFO_API, fetchImpl, signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' })
    })
  };
  const entries = await Promise.all(
    Object.entries(requests).map(async ([key, request]) => [key, await request.then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    )])
  );
  return buildHyperliquidAnalyticsSnapshot(Object.fromEntries(entries));
}
