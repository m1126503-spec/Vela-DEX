// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { SUPPORTED_TOKENS } from '../lib/stonSwap';
import { calculateFuturesEstimate } from '../lib/futuresEstimate';
import {
  fetchStormIntent,
  fetchStormMarkets,
  getStormV3Config,
  loadTrackedStormIntents,
  normalizeStormIntentHash,
  saveTrackedStormIntent
} from '../lib/stormV3';
import PriceChart from './PriceChart';
import MarketsList from './MarketsList';
import HyperliquidPanel from './HyperliquidPanel';

const LEVERAGE_PRESETS = [1, 2, 5, 10, 20, 50];
const ORDER_TYPES = [
  { value: 'market', label: 'Market' },
  { value: 'limit', label: 'Limit' },
  { value: 'stop', label: 'Stop' }
];
const FUTURES_ASSETS = SUPPORTED_TOKENS.filter((token) => token.symbol !== 'USDT');
const STORM_CONFIG = getStormV3Config();
const MISSING_STORM_CONFIG = [
  !STORM_CONFIG.isTestnet && 'VITE_STORM_V3_NETWORK=testnet',
  STORM_CONFIG.isTestnet && !STORM_CONFIG.apiUrl && 'VITE_STORM_V3_API_URL',
  STORM_CONFIG.isTestnet && !STORM_CONFIG.marketsUrl && 'VITE_STORM_V3_MARKETS_URL'
].filter(Boolean);

function formatEstimate(value, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU', { maximumFractionDigits });
}

export default function FuturesPanel() {
  const [venue, setVenue] = useState('hyperliquid');
  const [side, setSide] = useState('long');
  const [orderType, setOrderType] = useState('market');
  const [asset, setAsset] = useState(FUTURES_ASSETS[0].symbol);
  const [leverage, setLeverage] = useState(5);
  const [margin, setMargin] = useState('');
  const [price, setPrice] = useState('');
  const [stormMarkets, setStormMarkets] = useState({ loading: false, rows: [], error: '' });
  const [marketsRefresh, setMarketsRefresh] = useState(0);
  const [intentHash, setIntentHash] = useState('');
  const [trackedIntents, setTrackedIntents] = useState([]);
  const [intentResults, setIntentResults] = useState({});
  const [intentPending, setIntentPending] = useState('');
  const [intentError, setIntentError] = useState('');
  const [storageError, setStorageError] = useState('');
  const estimate = useMemo(() => calculateFuturesEstimate({
    margin,
    price,
    leverage,
    side,
    orderType,
    availableBalance: null
  }), [leverage, margin, orderType, price, side]);

  useEffect(() => {
    try {
      setTrackedIntents(loadTrackedStormIntents(window.localStorage));
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (!STORM_CONFIG.isTestnet || !STORM_CONFIG.marketsUrl) {
      setStormMarkets({ loading: false, rows: [], error: '' });
      return undefined;
    }

    const controller = new AbortController();
    setStormMarkets({ loading: true, rows: [], error: '' });
    fetchStormMarkets(STORM_CONFIG.marketsUrl, { signal: controller.signal })
      .then((rows) => setStormMarkets({ loading: false, rows, error: '' }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setStormMarkets({
          loading: false,
          rows: [],
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return () => controller.abort();
  }, [marketsRefresh]);

  async function checkStormIntent(value) {
    const hash = normalizeStormIntentHash(value);
    if (!hash) {
      setIntentError('Введите 64-символьный hex-хэш intent.');
      return;
    }
    if (!STORM_CONFIG.isTestnet || !STORM_CONFIG.apiUrl || intentPending) return;

    try {
      setTrackedIntents(saveTrackedStormIntent(hash, window.localStorage));
      setIntentHash(hash);
      setIntentError('');
    } catch (error) {
      setIntentError(error instanceof Error ? error.message : String(error));
      return;
    }

    setIntentPending(hash);
    setIntentResults((current) => ({ ...current, [hash]: { loading: true } }));
    try {
      const result = await fetchStormIntent(STORM_CONFIG.apiUrl, hash);
      setIntentResults((current) => ({ ...current, [hash]: result }));
    } catch (error) {
      setIntentResults((current) => ({
        ...current,
        [hash]: { error: error instanceof Error ? error.message : String(error) }
      }));
    } finally {
      setIntentPending('');
    }
  }

  return (
    <main className="card futures-card">
      <div className="futures-venue-switch" role="tablist" aria-label="Площадка для фьючерсов">
        <button type="button" role="tab" aria-selected={venue === 'hyperliquid'} className={venue === 'hyperliquid' ? 'active' : ''} onClick={() => setVenue('hyperliquid')}>Hyperliquid · testnet</button>
        <button type="button" role="tab" aria-selected={venue === 'storm'} className={venue === 'storm' ? 'active' : ''} onClick={() => setVenue('storm')}>Storm V3 · read-only</button>
      </div>

      {venue === 'hyperliquid' && <HyperliquidPanel />}

      <section className="storm-venue-panel" hidden={venue !== 'storm'}>
      <div className="section-heading">
        <div><small>Storm Trade V3 · public reads</small><h2>Storm Futures</h2></div>
        <span className="chip futures-preview-chip">READ-ONLY</span>
      </div>

      <MarketsList activeSymbol={asset} onSelect={(sym) => setAsset(sym)} />

      <PriceChart symbol={asset} />

      <div className="futures-unavailable" role="status">
        <strong>{STORM_CONFIG.isTestnet ? 'Тестовая сеть Storm V3' : 'Тестнет Storm V3 не настроен'}</strong>
        <span>
          {STORM_CONFIG.isTestnet
            ? 'Режим testnet задан. Публичные чтения используют только настроенные URL; ордера и подписи отключены. Калькулятор ниже — оценка вручную, баланс основного кошелька не является залогом Storm.'
            : 'Storm выдает тестовый API и адреса контрактов через builder onboarding. Без точных URL приложение не обращается к сети.'}
          {' '}Для торговли нужны тестовый Smart Account с залогом и зарегистрированный Ed25519 signer; TonConnect/ton_proof его не заменяют.
        </span>
        {MISSING_STORM_CONFIG.length > 0 && (
          <small>Нужны публичные настройки {MISSING_STORM_CONFIG.join(', ')}. URL и адреса контрактов выдаются Storm через builder onboarding.</small>
        )}
      </div>

      {STORM_CONFIG.isTestnet && (
        <section className="storm-readonly-section" aria-live="polite">
          <div className="storm-section-heading">
            <h3>Рынки Storm testnet</h3>
            {STORM_CONFIG.marketsUrl && (
              <button
                className="text-button"
                type="button"
                disabled={stormMarkets.loading}
                onClick={() => setMarketsRefresh((value) => value + 1)}
              >{stormMarkets.loading ? 'Загрузка…' : 'Обновить'}</button>
            )}
          </div>
          {!STORM_CONFIG.marketsUrl && <p className="muted">Укажите VITE_STORM_V3_MARKETS_URL из builder onboarding; адреса mainnet не подставляются.</p>}
          {stormMarkets.loading && <p className="muted">Загружаем список рынков из Storm…</p>}
          {stormMarkets.error && <p className="inline-warning" role="alert">Не удалось получить рынки: {stormMarkets.error}</p>}
          {!stormMarkets.loading && !stormMarkets.error && STORM_CONFIG.marketsUrl && stormMarkets.rows.length === 0 && (
            <p className="muted">Storm не вернул доступных рынков testnet.</p>
          )}
          {stormMarkets.rows.map((market) => (
            <div className="storm-market-row" key={market.address}>
              <span><strong>{market.ticker}</strong><small>{market.name}</small></span>
              <span className="storm-market-state">{market.isPaused ? 'Пауза' : market.isCloseOnly ? 'Только закрытие' : market.status}</span>
            </div>
          ))}
        </section>
      )}

      {STORM_CONFIG.isTestnet && STORM_CONFIG.apiUrl && (
        <section className="storm-readonly-section storm-intent-section">
          <div className="storm-section-heading"><h3>Проверка сохраненного intent</h3></div>
          <p className="muted">Сначала хэш сохраняется локально, затем запрашивается статус. Кнопка никогда не создает и не повторяет ордер.</p>
          <form
            className="storm-intent-form"
            onSubmit={(event) => {
              event.preventDefault();
              checkStormIntent(intentHash);
            }}
          >
            <label className="field-label">Intent hash (hex)
              <input
                className="full-input"
                autoComplete="off"
                spellCheck="false"
                value={intentHash}
                onChange={(event) => setIntentHash(event.target.value)}
                placeholder="64 hex-символа"
              />
            </label>
            <button className="secondary-button" type="submit" disabled={Boolean(intentPending) || Boolean(storageError)}>
              {intentPending ? 'Проверяем…' : 'Сохранить хэш и проверить'}
            </button>
          </form>
          {storageError && <p className="inline-warning" role="alert">{storageError}</p>}
          {intentError && <p className="inline-warning" role="alert">{intentError}</p>}
          {trackedIntents.map((hash) => {
            const result = intentResults[hash];
            return (
              <div className="storm-intent-row" key={hash}>
                <code>{hash}</code>
                <button
                  className="text-button"
                  type="button"
                  disabled={Boolean(intentPending)}
                  onClick={() => checkStormIntent(hash)}
                >{result?.loading ? 'Проверяем…' : 'Проверить'}</button>
                {result && !result.loading && (
                  <p className={result.error || !result.found ? 'inline-warning' : 'muted'} role={result.error ? 'alert' : 'status'}>
                    {result.error
                      ? `Статус не получен: ${result.error}`
                      : !result.found
                        ? 'Хэш не найден в этом API. Это не доказывает, что запрос не был принят; не создавайте дубликат без проверки истории.'
                        : `Статус API: ${result.status}. Даже accepted/done не подтверждают fill; сверяйте bundle, транзакции и состояние позиции.`}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      <div className="futures-direction" aria-label="Направление позиции">
        <button
          type="button"
          className={side === 'long' ? 'futures-side long active' : 'futures-side long'}
          aria-pressed={side === 'long'}
          onClick={() => setSide('long')}
        >Long</button>
        <button
          type="button"
          className={side === 'short' ? 'futures-side short active' : 'futures-side short'}
          aria-pressed={side === 'short'}
          onClick={() => setSide('short')}
        >Short</button>
      </div>

      <label className="field-label futures-field">Актив для расчета
        <select className="full-select" value={asset} onChange={(event) => setAsset(event.target.value)}>
          {FUTURES_ASSETS.map((token) => <option value={token.symbol} key={token.symbol}>{token.symbol} / USDT</option>)}
        </select>
      </label>

      <div className="futures-label-row">
        <span>Кредитное плечо</span>
        <strong>{leverage}x</strong>
      </div>
      <div className="risk-meter" aria-hidden="true"><span style={{ '--fill': `${(leverage / 50) * 100}%` }} /></div>
      <input
        className="leverage-slider"
        type="range"
        min="1"
        max="50"
        step="1"
        value={leverage}
        aria-label="Кредитное плечо"
        onChange={(event) => setLeverage(Number(event.target.value))}
        style={{ '--leverage-progress': `${((leverage - 1) / 49) * 100}%` }}
      />
      <div className="leverage-presets" aria-label="Быстрый выбор плеча">
        {LEVERAGE_PRESETS.map((value) => (
          <button
            type="button"
            key={value}
            className={leverage === value ? 'leverage-preset active' : 'leverage-preset'}
            aria-pressed={leverage === value}
            onClick={() => setLeverage(value)}
          >{value}x</button>
        ))}
      </div>

      <div className="futures-order-types" role="group" aria-label="Тип ордера">
        {ORDER_TYPES.map((type) => (
          <button
            type="button"
            key={type.value}
            className={orderType === type.value ? 'futures-order-type active' : 'futures-order-type'}
            aria-pressed={orderType === type.value}
            onClick={() => setOrderType(type.value)}
          >{type.label}</button>
        ))}
      </div>

      <label className="field-label futures-field">
        {orderType === 'market' ? 'Оценочная цена (USD)' : orderType === 'limit' ? 'Цена лимитного ордера (USD)' : 'Цена активации (USD)'}
        <input
          className="full-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Введите цену вручную"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </label>

      <label className="field-label futures-field">Маржа (USDT)
        <input
          className="full-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={margin}
          onChange={(event) => setMargin(event.target.value)}
        />
      </label>

      {estimate.error && <p className="inline-warning futures-validation" role="alert">{estimate.error}</p>}

      {!estimate.error && (
        <section className="futures-estimate" aria-live="polite">
          <div><span>Размер позиции</span><strong>{formatEstimate(estimate.positionUsd)} USDT</strong></div>
          <div><span>Объем актива</span><strong>{formatEstimate(estimate.assetQuantity, 6)} {asset}</strong></div>
          <div><span>Расчетное движение против позиции до потери маржи*</span><strong className={leverage >= 20 ? 'futures-risk-high' : ''}>≈ {formatEstimate(estimate.adverseMovePercent)}%</strong></div>
        </section>
      )}

      <button type="button" className="primary-button futures-primary" disabled>
        Отправка ордеров отключена
      </button>
      <p className="fine-print centered futures-disclaimer">
        * Упрощенная арифметическая оценка: без поддерживающей маржи, funding, комиссий, проскальзывания и правил ликвидации. Не является котировкой или обещанием цены исполнения.
      </p>
      </section>
    </main>
  );
}
