const INTENT_HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const TRACKED_INTENTS_KEY = 'vela-storm-v3-intents-v1';
const MAX_TRACKED_INTENTS = 50;
const REQUEST_TIMEOUT_MS = 12_000;

function parsePublicHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:'
      || url.hostname.toLowerCase() === 'api.storm.tg'
      || url.username
      || url.password
      || url.search
      || url.hash) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function getStormV3Config(env = import.meta.env || {}) {
  const network = typeof env.VITE_STORM_V3_NETWORK === 'string'
    ? env.VITE_STORM_V3_NETWORK.trim().toLowerCase()
    : '';
  const isTestnet = network === 'testnet';

  return {
    isTestnet,
    apiUrl: isTestnet ? parsePublicHttpsUrl(env.VITE_STORM_V3_API_URL) : null,
    marketsUrl: isTestnet ? parsePublicHttpsUrl(env.VITE_STORM_V3_MARKETS_URL) : null
  };
}

async function readJsonResponse(response, operation) {
  if (!response.ok) {
    throw new Error(`${operation}: HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation}: Storm вернул некорректный JSON.`);
  }
}

async function requestStormJson(url, operation, { signal, fetchImpl, notFoundOk = false }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new Error(`${operation}: истекло время ожидания.`)),
    REQUEST_TIMEOUT_MS
  );
  const abortRequest = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abortRequest, { once: true });

  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal
    });
    const data = response.status === 404 && notFoundOk
      ? null
      : await readJsonResponse(response, operation);
    return { response, data };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortRequest);
  }
}

export async function fetchStormMarkets(marketsUrl, { signal, fetchImpl = fetch } = {}) {
  const url = parsePublicHttpsUrl(marketsUrl);
  if (!url) throw new Error('Нужен корректный HTTPS URL списка рынков из Storm builder onboarding.');

  const { data } = await requestStormJson(url, 'Список рынков Storm', { signal, fetchImpl });
  if (!Array.isArray(data)) {
    throw new Error('Список рынков Storm имеет неожиданный формат.');
  }

  return data.map((market, index) => {
    const address = market?.address;
    const config = market?.config;
    if (typeof address !== 'string' || !address || typeof config?.ticker !== 'string' || !config.ticker) {
      throw new Error(`Рынок Storm #${index + 1} имеет неожиданный формат.`);
    }

    const status = market.settings?.status;
    if (typeof status !== 'string'
      || typeof market.settings?.isPaused !== 'boolean'
      || typeof market.settings.isCloseOnly !== 'boolean') {
      throw new Error(`Настройки рынка Storm #${index + 1} имеют неожиданный формат.`);
    }
    return {
      address,
      ticker: config.ticker,
      name: typeof config.name === 'string' ? config.name : config.ticker,
      status,
      isPaused: market.settings.isPaused,
      isCloseOnly: market.settings.isCloseOnly
    };
  });
}

export function normalizeStormIntentHash(value) {
  if (typeof value !== 'string') return null;
  const hash = value.trim().replace(/^0x/i, '');
  return INTENT_HASH.test(hash) ? hash.toLowerCase() : null;
}

export async function fetchStormIntent(apiUrl, value, { signal, fetchImpl = fetch } = {}) {
  const baseUrl = parsePublicHttpsUrl(apiUrl);
  const hash = normalizeStormIntentHash(value);
  if (!baseUrl) throw new Error('Нужен корректный HTTPS URL V3 API из Storm builder onboarding.');
  if (!hash) throw new Error('Введите 64-символьный hex-хэш intent.');

  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/intent/${hash}`;
  const { response, data } = await requestStormJson(url, 'Проверка intent', {
    signal,
    fetchImpl,
    notFoundOk: true
  });
  if (response.status === 404) return { found: false, hash, status: 'not_found' };

  return {
    found: true,
    hash,
    status: typeof data?.status === 'string' ? data.status : 'unknown'
  };
}

export function loadTrackedStormIntents(storage) {
  const raw = storage.getItem(TRACKED_INTENTS_KEY);
  if (raw === null) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Локальный список хэшей Storm поврежден; он не был изменен.');
  }
  if (!Array.isArray(parsed) || parsed.some((value) => !normalizeStormIntentHash(value))) {
    throw new Error('Локальный список хэшей Storm имеет неожиданный формат; он не был изменен.');
  }
  return [...new Set(parsed.map(normalizeStormIntentHash))];
}

export function saveTrackedStormIntent(value, storage) {
  const hash = normalizeStormIntentHash(value);
  if (!hash) throw new Error('Введите 64-символьный hex-хэш intent.');

  const intents = loadTrackedStormIntents(storage);
  if (intents.includes(hash)) return intents;
  if (intents.length >= MAX_TRACKED_INTENTS) {
    throw new Error(`Сохранено максимальное число хэшей (${MAX_TRACKED_INTENTS}); существующие записи не удалены.`);
  }

  const updated = [...intents, hash];
  storage.setItem(TRACKED_INTENTS_KEY, JSON.stringify(updated));
  return updated;
}
