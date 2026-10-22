import { useMemo, useState } from 'react';
import { useTonConnectUI } from '@tonconnect/ui-react';
import { formatTokenAmount, getWalletTokenBalance, SUPPORTED_TOKENS } from '../lib/stonSwap';
import { calculateFuturesEstimate } from '../lib/futuresEstimate';

const LEVERAGE_PRESETS = [1, 2, 5, 10, 20, 50];
const ORDER_TYPES = [
  { value: 'market', label: 'Market' },
  { value: 'limit', label: 'Limit' },
  { value: 'stop', label: 'Stop' }
];
const COLLATERAL_TOKEN = SUPPORTED_TOKENS.find((token) => token.symbol === 'USDT');
const FUTURES_ASSETS = SUPPORTED_TOKENS.filter((token) => token.symbol !== 'USDT');

function formatEstimate(value, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU', { maximumFractionDigits });
}

export default function FuturesPanel({ wallet, walletData, onOpenSwap }) {
  const [tonConnectUI] = useTonConnectUI();
  const [connectError, setConnectError] = useState('');
  const [side, setSide] = useState('long');
  const [orderType, setOrderType] = useState('market');
  const [asset, setAsset] = useState(FUTURES_ASSETS[0].symbol);
  const [leverage, setLeverage] = useState(5);
  const [margin, setMargin] = useState('');
  const [price, setPrice] = useState('');
  const isMainnet = wallet?.account?.chain === '-239';
  const balanceUnits = getWalletTokenBalance(walletData, COLLATERAL_TOKEN);
  const availableBalance = !wallet || !isMainnet || balanceUnits === null
    ? null
    : Number(balanceUnits) / 1_000_000;
  const estimate = useMemo(() => calculateFuturesEstimate({
    margin,
    price,
    leverage,
    side,
    orderType,
    availableBalance
  }), [availableBalance, leverage, margin, orderType, price, side]);
  const tonBalanceUnits = getWalletTokenBalance(walletData, SUPPORTED_TOKENS[0]);
  const displayedBalance = !wallet
    ? 'Подключите кошелек'
    : !isMainnet
      ? 'Только mainnet'
      : walletData.loading
        ? 'Загрузка…'
        : balanceUnits === null
          ? 'Нет данных'
          : `${formatTokenAmount(balanceUnits, COLLATERAL_TOKEN.decimals, 2)} USDT`;

  function setMarginPercent(percent) {
    if (availableBalance === null) return;
    setMargin(formatEstimate(availableBalance * percent, 6).replace(/\s/g, '').replace(',', '.'));
  }

  async function connectWallet() {
    try {
      setConnectError('');
      await tonConnectUI.openModal();
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="card futures-card">
      <div className="section-heading">
        <div><small>Расчет позиции · без исполнения</small><h2>Futures</h2></div>
        <span className="chip futures-preview-chip">PREVIEW</span>
      </div>

      <div className="futures-unavailable" role="status">
        <strong>Фьючерсный протокол не подключен</strong>
        <span>Расчеты ниже — предварительная оценка по введенной вручную цене. Ордер не будет отправлен, а котировка и комиссии не загружаются.</span>
      </div>

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

      <div className="futures-field-heading">
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
        <span className="futures-balance">Доступно: {displayedBalance}</span>
      </div>

      <div className="futures-quick-amounts" aria-label="Быстрый выбор маржи">
        {[0.25, 0.5].map((percent) => (
          <button type="button" key={percent} disabled={availableBalance === null} onClick={() => setMarginPercent(percent)}>
            {percent * 100}%
          </button>
        ))}
        <button type="button" disabled={availableBalance === null} onClick={() => setMarginPercent(1)}>MAX</button>
      </div>

      {estimate.error && <p className="inline-warning futures-validation" role="alert">{estimate.error}</p>}
      {wallet && !isMainnet && <p className="inline-warning futures-validation">Подключен testnet-кошелек. Балансы mainnet для обеспечения не используются.</p>}
      {wallet && isMainnet && balanceUnits === null && !walletData.loading && (
        <p className="inline-warning futures-validation">Не удалось проверить баланс USDT. Проверьте подключение к TonAPI.</p>
      )}
      {wallet && isMainnet && !walletData.loading && (
        tonBalanceUnits === null || BigInt(tonBalanceUnits) === 0n
      ) && (
        <p className="inline-warning futures-validation">Баланс TON не получен или равен нулю. Требуемый запас на газ неизвестен, поскольку фьючерсный протокол не подключен.</p>
      )}
      {wallet && isMainnet && availableBalance === 0 && (
        <p className="inline-warning futures-validation">Баланс USDT равен нулю. Минимальный размер ордера не задан и должен поступать от торгового протокола.</p>
      )}

      {!estimate.error && (
        <section className="futures-estimate" aria-live="polite">
          <div><span>Размер позиции</span><strong>{formatEstimate(estimate.positionUsd)} USDT</strong></div>
          <div><span>Объем актива</span><strong>{formatEstimate(estimate.assetQuantity, 6)} {asset}</strong></div>
          <div><span>Расчетное движение против позиции до потери маржи*</span><strong className={leverage >= 20 ? 'futures-risk-high' : ''}>≈ {formatEstimate(estimate.adverseMovePercent)}%</strong></div>
        </section>
      )}

      {availableBalance === 0 && onOpenSwap && (
        <button type="button" className="text-button futures-fund-link" onClick={onOpenSwap}>Открыть Spot и обменять токены ↗</button>
      )}

      {connectError && <p className="inline-warning futures-validation" role="alert">Не удалось открыть TonConnect: {connectError}</p>}
      {!wallet ? (
        <button type="button" className="primary-button futures-primary" onClick={connectWallet}>Подключить кошелек</button>
      ) : (
        <button type="button" className="primary-button futures-primary" disabled>
          Фьючерсная торговля недоступна
        </button>
      )}
      <p className="fine-print centered futures-disclaimer">
        * Упрощенная арифметическая оценка: без поддерживающей маржи, funding, комиссий, проскальзывания и правил ликвидации. Не является котировкой или обещанием цены исполнения.
      </p>
    </main>
  );
}
