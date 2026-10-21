import { useEffect, useMemo, useState } from 'react';
import {
  TonConnectButton,
  useTonAddress,
  useTonConnectUI,
  useTonWallet
} from '@tonconnect/ui-react';
import { APP_NAME, PLATFORM_WALLET_ADDRESS, TELEGRAM_BOT_USERNAME } from './config';
import {
  addLiquidity,
  calculateSwap,
  formatAmount,
  getPoolKey,
  initialDemoState,
  removeLiquidity
} from './lib/amm';
import { fetchWalletEvents, fetchWalletJettons, fetchWalletTonBalance } from './lib/tonApi';

const TOKENS = [
  { symbol: 'TON', name: 'Toncoin', icon: 'T', decimals: 9 },
  { symbol: 'USDT', name: 'Tether USDt', icon: '$', decimals: 6 },
  { symbol: 'NOT', name: 'Notcoin', icon: 'N', decimals: 9 }
];
const SLIPPAGE_PERCENT = 0.5;
const STORAGE_KEY = 'vela-dex-demo-v1';

function loadDemoState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return initialDemoState();
    const parsed = JSON.parse(stored);
    if (!parsed?.balances || !parsed?.pools || !Array.isArray(parsed?.history)) {
      return initialDemoState();
    }
    const clean = initialDemoState();
    for (const symbol of Object.keys(clean.balances)) {
      const value = Number(parsed.balances[symbol]);
      if (Number.isFinite(value) && value >= 0 && value <= 1e18) clean.balances[symbol] = value;
    }
    for (const key of Object.keys(clean.pools)) {
      const pool = parsed.pools[key];
      if (!pool || pool.token0 !== clean.pools[key].token0 || pool.token1 !== clean.pools[key].token1) continue;
      const { reserve0, reserve1, totalLp } = pool;
      if ([reserve0, reserve1, totalLp].every((value) => Number.isFinite(value) && value > 0)) {
        clean.pools[key] = { token0: pool.token0, token1: pool.token1, reserve0, reserve1, totalLp };
      }
    }
    for (const key of Object.keys(clean.positions)) {
      const value = Number(parsed.positions?.[key]);
      if (Number.isFinite(value) && value >= 0) {
        clean.positions[key] = Math.min(value, clean.pools[key].totalLp);
      }
    }
    clean.history = parsed.history.filter((item) => item
      && typeof item.id === 'string'
      && typeof item.description === 'string'
      && typeof item.details === 'string'
      && Number.isFinite(item.timestamp)).slice(0, 30);
    return clean;
  } catch {
    return initialDemoState();
  }
}

function isValidTokenAmount(value, token) {
  const decimals = token.decimals;
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
  return pattern.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;
}

function applyTelegramTheme(theme = {}) {
  const defaults = {
    bg_color: '#0b1220',
    secondary_bg_color: '#101827',
    text_color: '#f8fafc',
    hint_color: '#94a3b8',
    link_color: '#5da9ff',
    button_color: '#3b82f6',
    button_text_color: '#ffffff',
    header_bg_color: '#0f172a',
    accent_text_color: '#7dd3fc'
  };
  for (const [name, fallback] of Object.entries(defaults)) {
    document.documentElement.style.setProperty(
      `--tg-theme-${name.replaceAll('_', '-')}`,
      theme[name] || fallback
    );
  }
}

function parseTonAmount(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const nano = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0') || '0');
  return nano > 0n ? nano.toString() : null;
}

function App() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const walletAddress = useTonAddress();
  const [activeTab, setActiveTab] = useState('swap');
  const [demo, setDemo] = useState(loadDemoState);
  const [fromToken, setFromToken] = useState(TOKENS[0]);
  const [toToken, setToToken] = useState(TOKENS[1]);
  const [swapAmount, setSwapAmount] = useState('1');
  const [selectedPool, setSelectedPool] = useState('TON-USDT');
  const [poolMode, setPoolMode] = useState('add');
  const [liquidityAmount, setLiquidityAmount] = useState('1');
  const [removePercent, setRemovePercent] = useState('25');
  const [notice, setNotice] = useState('');
  const [walletData, setWalletData] = useState({
    loading: false, balance: null, jettons: null, events: null, errors: []
  });
  const [walletDataRefresh, setWalletDataRefresh] = useState(0);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferPending, setTransferPending] = useState(false);

  const telegram = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
    } catch (error) {
      console.warn('Demo state could not be saved:', error);
    }
  }, [demo]);

  useEffect(() => {
    if (!telegram) return;
    telegram.ready();
    applyTelegramTheme(telegram.themeParams || {});
    telegram.expand?.();
    const onThemeChanged = () => applyTelegramTheme(telegram.themeParams || {});
    telegram.onEvent?.('themeChanged', onThemeChanged);
    return () => telegram.offEvent?.('themeChanged', onThemeChanged);
  }, [telegram]);

  useEffect(() => {
    if (!walletAddress) {
      setWalletData({ loading: false, balance: null, jettons: null, events: null, errors: [] });
      return undefined;
    }
    let cancelled = false;
    setWalletData({ loading: true, balance: null, jettons: null, events: null, errors: [] });
    const sources = [
      ['balance', fetchWalletTonBalance(walletAddress)],
      ['jettons', fetchWalletJettons(walletAddress)],
      ['events', fetchWalletEvents(walletAddress)]
    ];
    Promise.all(sources.map(async ([key, request]) => {
      try {
        return [key, await request, null];
      } catch (error) {
        return [key, null, error instanceof Error ? error.message : String(error)];
      }
    })).then((results) => {
      if (cancelled) return;
      const next = { loading: false, balance: null, jettons: null, events: null, errors: [] };
      for (const [key, data, error] of results) {
        next[key] = data;
        if (error) next.errors.push(`${key}: ${error}`);
      }
      setWalletData(next);
    });
    return () => { cancelled = true; };
  }, [walletAddress, walletDataRefresh]);

  const poolKey = getPoolKey(fromToken.symbol, toToken.symbol);
  const swapPool = demo.pools[poolKey];
  const swapPreview = useMemo(() => {
    if (!swapPool) return null;
    const zeroToOne = fromToken.symbol === swapPool.token0;
    return calculateSwap(
      Number(swapAmount),
      zeroToOne ? swapPool.reserve0 : swapPool.reserve1,
      zeroToOne ? swapPool.reserve1 : swapPool.reserve0
    );
  }, [fromToken.symbol, swapAmount, swapPool, toToken.symbol]);
  const swapValid = Boolean(
    swapPreview
    && swapPreview.amountOut > 0
    && isValidTokenAmount(swapAmount, fromToken)
    && (Number(swapAmount) <= demo.balances[fromToken.symbol])
  );

  const activePool = demo.pools[selectedPool];
  const token0 = TOKENS.find((token) => token.symbol === activePool.token0);
  const token1 = TOKENS.find((token) => token.symbol === activePool.token1);
  const addPreview = useMemo(
    () => addLiquidity(activePool, Number(liquidityAmount)),
    [activePool, liquidityAmount]
  );
  const position = demo.positions[selectedPool] || 0;
  const removePreview = useMemo(
    () => removeLiquidity(activePool, position, Number(removePercent)),
    [activePool, position, removePercent]
  );
  const addValid = Boolean(
    addPreview
    && isValidTokenAmount(liquidityAmount, token0)
    && addPreview.amount0 > 0
    && addPreview.amount1 > 0
    && addPreview.amount0 <= demo.balances[token0.symbol]
    && addPreview.amount1 <= demo.balances[token1.symbol]
  );
  const removeValid = Boolean(removePreview && removePreview.amount0 > 0 && position > 0);

  function recordHistory(state, entry) {
    return { ...state, history: [{ id: `${Date.now()}-${Math.random()}`, ...entry }, ...state.history].slice(0, 30) };
  }

  function simulateSwap() {
    if (!swapValid || !swapPool) return;
    const amountIn = Number(swapAmount);
    const zeroToOne = fromToken.symbol === swapPool.token0;
    const result = calculateSwap(
      amountIn,
      zeroToOne ? swapPool.reserve0 : swapPool.reserve1,
      zeroToOne ? swapPool.reserve1 : swapPool.reserve0
    );
    if (!result || result.amountOut <= 0) return;
    setDemo((current) => {
      const pool = current.pools[poolKey];
      const balances = { ...current.balances };
      balances[fromToken.symbol] -= amountIn;
      balances[toToken.symbol] += result.amountOut;
      const updatedPool = zeroToOne
        ? { ...pool, reserve0: pool.reserve0 + amountIn, reserve1: pool.reserve1 - result.amountOut }
        : { ...pool, reserve1: pool.reserve1 + amountIn, reserve0: pool.reserve0 - result.amountOut };
      return recordHistory({
        ...current,
        balances,
        pools: { ...current.pools, [poolKey]: updatedPool }
      }, {
        type: 'DEMO_SWAP',
        timestamp: Date.now(),
        description: `${formatAmount(amountIn, fromToken.symbol)} ${fromToken.symbol} → ${formatAmount(result.amountOut, toToken.symbol)} ${toToken.symbol}`,
        details: `Симуляция AMM; комиссия пула ${formatAmount(result.fee, fromToken.symbol)} ${fromToken.symbol}`
      });
    });
    setNotice(`Свап симулирован: ${formatAmount(result.amountOut, toToken.symbol)} ${toToken.symbol}. Средства кошелька не отправлялись.`);
  }

  function applyLiquidityChange() {
    if (poolMode === 'add') {
      if (!addValid) return;
      setDemo((current) => {
        const pool = current.pools[selectedPool];
        const result = addLiquidity(pool, Number(liquidityAmount));
        if (!result
          || result.amount0 > current.balances[token0.symbol]
          || result.amount1 > current.balances[token1.symbol]) return current;
        const balances = { ...current.balances };
        balances[token0.symbol] -= result.amount0;
        balances[token1.symbol] -= result.amount1;
        return recordHistory({
          ...current,
          balances,
          pools: { ...current.pools, [selectedPool]: result.pool },
          positions: { ...current.positions, [selectedPool]: (current.positions[selectedPool] || 0) + result.mintedLp }
        }, {
          type: 'DEMO_ADD_LIQUIDITY',
          timestamp: Date.now(),
          description: `Добавлено ${formatAmount(result.amount0, token0.symbol)} ${token0.symbol} + ${formatAmount(result.amount1, token1.symbol)} ${token1.symbol}`,
          details: 'Демо-позиция LP; ончейн-транзакция не отправлялась'
        });
      });
      setNotice('Ликвидность добавлена только в демо-модель.');
      return;
    }
    if (!removeValid) return;
    setDemo((current) => {
      const pool = current.pools[selectedPool];
      const result = removeLiquidity(pool, current.positions[selectedPool] || 0, Number(removePercent));
      if (!result) return current;
      const balances = { ...current.balances };
      balances[token0.symbol] += result.amount0;
      balances[token1.symbol] += result.amount1;
      return recordHistory({
        ...current,
        balances,
        pools: { ...current.pools, [selectedPool]: result.pool },
        positions: { ...current.positions, [selectedPool]: result.remainingLp }
      }, {
        type: 'DEMO_REMOVE_LIQUIDITY',
        timestamp: Date.now(),
        description: `Выведено ${formatAmount(result.amount0, token0.symbol)} ${token0.symbol} + ${formatAmount(result.amount1, token1.symbol)} ${token1.symbol}`,
        details: 'Демо-позиция LP; ончейн-транзакция не отправлялась'
      });
    });
    setNotice('Ликвидность выведена только из демо-модели.');
  }

  async function submitVoluntaryTransfer() {
    const amount = parseTonAmount(transferAmount);
    if (!amount || !wallet) {
      setNotice('Подключите кошелек и укажите корректную сумму TON (до 9 знаков после запятой).');
      return;
    }
    setTransferPending(true);
    try {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{ address: PLATFORM_WALLET_ADDRESS, amount }]
      });
      setTransferDialogOpen(false);
      setNotice('TonConnect вернул успешный результат запроса перевода. Это отдельный перевод, не связанный с демо-свапом.');
      setWalletDataRefresh((value) => value + 1);
    } catch (error) {
      setNotice(`Перевод не подтвержден: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTransferPending(false);
    }
  }

  function resetDemo() {
    setDemo(initialDemoState());
    setNotice('Демо-балансы, пулы и история сброшены.');
  }

  const balanceOf = (symbol) => formatAmount(demo.balances[symbol] || 0, symbol);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div><small>TON Mini App</small><h1>{APP_NAME}</h1></div>
        </div>
        <div className="wallet-block"><TonConnectButton /></div>
      </header>

      <div className="demo-banner"><strong>DEMO</strong><span>Сделки и пулы симулируются в браузере. Ончейн-свапов нет.</span></div>

      {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Закрыть">×</button></div>}

      <nav className="tabs" aria-label="Разделы">
        {[['swap', 'Swap'], ['pool', 'Pool'], ['wallet', 'Wallet']].map(([key, label]) => (
          <button key={key} type="button" className={activeTab === key ? 'tab active' : 'tab'} onClick={() => setActiveTab(key)}>{label}</button>
        ))}
      </nav>

      {activeTab === 'swap' && (
        <main className="card">
          <div className="section-heading"><div><small>Constant-product AMM</small><h2>Swap</h2></div><span className="chip">SIMULATED</span></div>
          <div className="token-panel">
            <div className="panel-top"><span>Отдаете</span><span>Демо-баланс: {balanceOf(fromToken.symbol)}</span></div>
            <div className="amount-row">
              <input aria-label="Сумма отдаваемого токена" inputMode="decimal" type="number" min="0" step="any" value={swapAmount} onChange={(event) => setSwapAmount(event.target.value)} placeholder="0" />
              <select aria-label="Токен для обмена" value={fromToken.symbol} onChange={(event) => {
                const selected = TOKENS.find((token) => token.symbol === event.target.value);
                setFromToken(selected);
                if (selected.symbol === toToken.symbol) setToToken(fromToken);
              }}>
                {TOKENS.map((token) => <option key={token.symbol} value={token.symbol}>{token.icon} {token.symbol}</option>)}
              </select>
            </div>
          </div>
          <div className="swap-divider"><button className="icon-button" type="button" onClick={() => { setFromToken(toToken); setToToken(fromToken); }} aria-label="Поменять токены местами">⇅</button></div>
          <div className="token-panel">
            <div className="panel-top"><span>Получите (оценка)</span><span>Демо-баланс: {balanceOf(toToken.symbol)}</span></div>
            <div className="amount-row">
              <div className="receive-value">{formatAmount(swapPreview?.amountOut || 0, toToken.symbol)}</div>
              <select aria-label="Токен для получения" value={toToken.symbol} onChange={(event) => {
                const selected = TOKENS.find((token) => token.symbol === event.target.value);
                setToToken(selected);
                if (selected.symbol === fromToken.symbol) setFromToken(toToken);
              }}>
                {TOKENS.map((token) => <option key={token.symbol} value={token.symbol}>{token.icon} {token.symbol}</option>)}
              </select>
            </div>
          </div>
          {swapPreview && (
            <div className="details-box">
              <div className="detail-row"><span>Курс пула (до комиссии)</span><strong>1 {fromToken.symbol} = {formatAmount(swapPreview.spotRate, toToken.symbol)} {toToken.symbol}</strong></div>
              <div className="detail-row"><span>Комиссия LP (0,30%)</span><strong>{formatAmount(swapPreview.fee, fromToken.symbol)} {fromToken.symbol}</strong></div>
              <div className="detail-row"><span>Price impact (вкл. комиссию)</span><strong>{formatAmount(swapPreview.priceImpact, 'PERCENT')}%</strong></div>
              <div className="detail-row"><span>Минимум (slippage 0,5%)</span><strong>{formatAmount(swapPreview.amountOut * (1 - SLIPPAGE_PERCENT / 100), toToken.symbol)} {toToken.symbol}</strong></div>
              <p className="fine-print">Комиссия остается в демо-пуле. Сетевая комиссия не рассчитывается, потому что транзакция свапа не отправляется.</p>
            </div>
          )}
          {!swapPool && <p className="inline-warning">Для этой пары нет демо-пула. Выберите другую пару.</p>}
          {swapPool && swapAmount && !swapValid && <p className="inline-warning">Введите сумму больше нуля, не превышающую демо-баланс {balanceOf(fromToken.symbol)} {fromToken.symbol}.</p>}
          <button className="primary-button" type="button" disabled={!swapValid} onClick={simulateSwap}>Симулировать свап · DEMO</button>
          <p className="fine-print centered">Ничего не отправляется в блокчейн. Подключение кошелька для симуляции не требуется.</p>
        </main>
      )}

      {activeTab === 'pool' && (
        <main className="card">
          <div className="section-heading"><div><small>Локальные демо-резервы</small><h2>Pool</h2></div><span className="chip">SIMULATED</span></div>
          <label className="field-label">Пул
            <select className="full-select" value={selectedPool} onChange={(event) => setSelectedPool(event.target.value)}>
              {Object.keys(demo.pools).map((key) => <option key={key} value={key}>{key.replace('-', ' / ')}</option>)}
            </select>
          </label>
          <div className="pool-reserves">
            <div><span>Резерв {token0.symbol}</span><strong>{formatAmount(activePool.reserve0, token0.symbol)}</strong></div>
            <div><span>Резерв {token1.symbol}</span><strong>{formatAmount(activePool.reserve1, token1.symbol)}</strong></div>
            <div><span>Ваша LP-доля (demo)</span><strong>{formatAmount(position, 'LP')}</strong></div>
          </div>
          <div className="mode-switch">
            <button type="button" className={poolMode === 'add' ? 'mode active' : 'mode'} onClick={() => setPoolMode('add')}>Добавить</button>
            <button type="button" className={poolMode === 'remove' ? 'mode active' : 'mode'} onClick={() => setPoolMode('remove')}>Удалить</button>
          </div>
          {poolMode === 'add' ? (
            <>
              <div className="token-panel">
                <div className="panel-top"><span>Внесите {token0.symbol}</span><span>Демо-баланс: {balanceOf(token0.symbol)}</span></div>
                <div className="amount-row"><input aria-label={`Сумма ${token0.symbol}`} type="number" min="0" step="any" value={liquidityAmount} onChange={(event) => setLiquidityAmount(event.target.value)} /><span className="token-label">{token0.symbol}</span></div>
              </div>
              <div className="detail-row required-row"><span>Требуется {token1.symbol} (пропорция пула)</span><strong>{formatAmount(addPreview?.amount1 || 0, token1.symbol)} {token1.symbol}</strong></div>
              <p className="fine-print">Оба баланса и LP-доля являются демо-данными. Перевода токенов или ончейн-добавления ликвидности не будет.</p>
              <button className="primary-button" type="button" disabled={!addValid} onClick={applyLiquidityChange}>Добавить ликвидность · DEMO</button>
            </>
          ) : (
            <>
              <div className="token-panel">
                <div className="panel-top"><span>Доля для вывода</span><span>Доступно: {formatAmount(position, 'LP')} LP</span></div>
                <div className="amount-row"><input aria-label="Процент доли для вывода" type="number" min="0" max="100" step="any" value={removePercent} onChange={(event) => setRemovePercent(event.target.value)} /><span className="token-label">%</span></div>
              </div>
              <div className="detail-row required-row"><span>Оценка вывода</span><strong>{formatAmount(removePreview?.amount0 || 0, token0.symbol)} {token0.symbol} + {formatAmount(removePreview?.amount1 || 0, token1.symbol)} {token1.symbol}</strong></div>
              {position <= 0 && <p className="inline-warning">В этом демо-пуле у вас нет LP-доли.</p>}
              <p className="fine-print">Вывод обновит только демо-модель и не создаст ончейн-транзакцию.</p>
              <button className="primary-button" type="button" disabled={!removeValid} onClick={applyLiquidityChange}>Удалить ликвидность · DEMO</button>
            </>
          )}
        </main>
      )}

      {activeTab === 'wallet' && (
        <main className="card">
          <div className="section-heading"><div><small>TonConnect · данные сети</small><h2>Wallet</h2></div></div>
          <div className="wallet-summary">
            <div className="wallet-title"><strong>{wallet ? 'Кошелек подключен' : 'Кошелек не подключен'}</strong><span className="chip">{wallet ? 'TONCONNECT' : 'DISCONNECTED'}</span></div>
            {walletAddress && <div className="address-value"><span>{walletAddress}</span><button type="button" className="text-button" onClick={() => navigator.clipboard?.writeText(walletAddress).then(() => setNotice('Адрес скопирован.')).catch(() => setNotice('Не удалось скопировать адрес.'))}>Копировать</button></div>}
            {!wallet && <p className="fine-print">Подключите кошелек кнопкой сверху. Адрес и данные сети появятся после подключения.</p>}
          </div>
          {wallet && (
            <section className="live-section">
              <div className="subheading"><h3>Реальные данные кошелька</h3><button className="text-button" type="button" onClick={() => setWalletDataRefresh((value) => value + 1)}>Обновить</button></div>
              {walletData.loading && <p className="muted">Загружаем данные TonAPI…</p>}
              {walletData.balance && <div className="detail-row"><span>Баланс TON</span><strong>{(Number(walletData.balance.balance) / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 4 })} TON</strong></div>}
              {walletData.jettons?.map((item) => {
                const jetton = item.jetton || item;
                const decimals = Number(jetton.decimals || 0);
                const balance = Number(item.balance || 0) / (10 ** decimals);
                return (
                  <div className="detail-row" key={jetton.address || jetton.symbol}>
                    <span>{jetton.symbol || 'Jetton'} · сеть</span>
                    <strong>{Number.isFinite(balance) ? balance.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) : '—'}</strong>
                  </div>
                );
              })}
              {walletData.errors.map((error) => <p className="inline-warning" key={error}>Не удалось загрузить {error}. Данные не подменены демо-балансом.</p>)}
              {!walletData.loading && !walletData.balance && !walletData.errors.length && <p className="muted">Сетевые данные не получены.</p>}
            </section>
          )}
          <div className="demo-balances">
            <div className="subheading"><h3>Демо-балансы</h3><span className="chip">НЕ ОНЧЕЙН</span></div>
            {TOKENS.map((token) => <div className="detail-row" key={token.symbol}><span>{token.symbol}</span><strong>{balanceOf(token.symbol)}</strong></div>)}
            <button className="text-button" type="button" onClick={resetDemo}>Сбросить демо-данные</button>
          </div>
          {wallet && PLATFORM_WALLET_ADDRESS && (
            <section className="transfer-card">
              <h3>Добровольный перевод разработчику</h3>
              <p>Это обычный перевод TON на указанный адрес. Он не является комиссией за свап, не связан с успешностью симуляции и не возвращается при ее отмене или неудаче.</p>
              <label className="field-label">Сумма перевода (TON)
                <input className="full-input" inputMode="decimal" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} placeholder="0.01" />
              </label>
              <button className="secondary-button" type="button" disabled={!parseTonAmount(transferAmount)} onClick={() => setTransferDialogOpen(true)}>Проверить перевод</button>
            </section>
          )}
          {wallet && (
            <section className="history-section">
              <div className="subheading"><h3>История кошелька (сеть)</h3></div>
              {walletData.loading && <p className="muted">Загрузка…</p>}
              {walletData.events?.events?.length > 0 ? walletData.events.events.map((event) => (
                <div className="history-item" key={event.event_id || event.lt}>
                  <strong>{event.actions?.[0]?.type || 'Событие TON'}</strong>
                  <span>{event.timestamp ? new Date(event.timestamp).toLocaleString('ru-RU') : 'Время неизвестно'}</span>
                  <small>{event.event_id || event.lt || 'ID не предоставлен TonAPI'}</small>
                </div>
              )) : (!walletData.loading && walletData.events && <p className="muted">Событий не найдено.</p>)}
              {walletData.errors.some((error) => error.startsWith('events:')) && <p className="muted">Сетевая история временно недоступна.</p>}
            </section>
          )}
          <section className="history-section">
            <div className="subheading"><h3>История симуляций</h3><span className="chip">DEMO</span></div>
            {demo.history.length ? demo.history.map((entry) => (
              <div className="history-item" key={entry.id}>
                <strong>{entry.description}</strong>
                <span>{new Date(entry.timestamp).toLocaleString('ru-RU')}</span>
                <small>{entry.details}</small>
              </div>
            )) : <p className="muted">Демо-операций пока нет.</p>}
          </section>
        </main>
      )}

      {transferDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
            <div className="modal-header"><h3 id="transfer-title">Подтвердите отдельный перевод</h3><button type="button" className="close-button" onClick={() => setTransferDialogOpen(false)} aria-label="Закрыть">×</button></div>
            <div className="transfer-confirm">
              <div><span>Сумма</span><strong>{transferAmount} TON</strong></div>
              <div><span>Получатель</span><strong className="mono">{PLATFORM_WALLET_ADDRESS}</strong></div>
            </div>
            <p className="inline-warning">Добровольный перевод через TonConnect. Это не комиссия за swap, не часть операции обмена и не гарантирует выполнение симуляции. После подтверждения в кошельке перевод не возвращается при отмене или неудаче симуляции.</p>
            <button type="button" className="primary-button" disabled={transferPending} onClick={submitVoluntaryTransfer}>{transferPending ? 'Ожидание кошелька…' : 'Я согласен — открыть TonConnect'}</button>
          </div>
        </div>
      )}

      <footer className="app-footer">
        Vela DEX · Demo on TON · No router contract ·{' '}
        <a href={`https://t.me/${TELEGRAM_BOT_USERNAME.replace(/^@/, '')}`} target="_blank" rel="noreferrer">Telegram</a>
      </footer>
    </div>
  );
}

export default App;
