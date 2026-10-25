// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid';
import { createWalletClient, custom, getAddress } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import {
  createHyperliquidClientOrderId,
  formatHyperliquidOrder,
  HYPERLIQUID_MAX_ORDER_NOTIONAL_USD,
  HYPERLIQUID_TESTNET_CHAIN_ID,
  readHyperliquidOrderHistory,
  writeHyperliquidOrderHistory
} from '../lib/hyperliquid';

const TESTNET_RPC = 'https://sepolia-rollup.arbitrum.io/rpc';
const TESTNET_EXPLORER = 'https://sepolia.arbiscan.io';
const transport = new HttpTransport({ isTestnet: true });
const infoClient = new InfoClient({ transport });

function formatNumber(value, digits = 4) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('en-US', { maximumFractionDigits: digits })
    : '—';
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function isWalletRejection(error) {
  return error?.code === 4001 || /user rejected|user denied|request rejected/i.test(errorText(error));
}

function resultStatus(response) {
  const statuses = response?.response?.data?.statuses;
  if (!Array.isArray(statuses) || statuses.length !== 1) {
    throw new Error('Ответ биржи не содержит ожидаемый статус одного ордера.');
  }
  const status = statuses[0];
  if (typeof status === 'string') return { kind: status, detail: status };
  if (status?.error) return { kind: 'rejected', detail: status.error };
  if (status?.resting) return { kind: 'resting', detail: `Ордер открыт, ID ${status.resting.oid}.` };
  if (status?.filled) {
    return {
      kind: 'filled',
      detail: `Исполнено ${status.filled.totalSz} по средней цене ${status.filled.avgPx}.`
    };
  }
  throw new Error('Биржа вернула неизвестный статус ордера.');
}

async function ensureTestnetChain(provider) {
  const chainId = await provider.request({ method: 'eth_chainId' });
  if (chainId?.toLowerCase() === HYPERLIQUID_TESTNET_CHAIN_ID) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: HYPERLIQUID_TESTNET_CHAIN_ID }]
    });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: HYPERLIQUID_TESTNET_CHAIN_ID,
        chainName: 'Arbitrum Sepolia',
        nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [TESTNET_RPC],
        blockExplorerUrls: [TESTNET_EXPLORER]
      }]
    });
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: HYPERLIQUID_TESTNET_CHAIN_ID }]
    });
  }
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function HyperliquidPanel() {
  const [markets, setMarkets] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [selectedCoin, setSelectedCoin] = useState('');
  const [marketError, setMarketError] = useState('');
  const [marketUpdatedAt, setMarketUpdatedAt] = useState(0);
  const [book, setBook] = useState(null);
  const [bookError, setBookError] = useState('');
  const [address, setAddress] = useState('');
  const [networkReady, setNetworkReady] = useState(false);
  const [account, setAccount] = useState(null);
  const [openOrders, setOpenOrders] = useState([]);
  const [accountError, setAccountError] = useState('');
  const [history, setHistory] = useState([]);
  const [storageError, setStorageError] = useState('');
  const [side, setSide] = useState('buy');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [review, setReview] = useState(null);
  const [cancelReview, setCancelReview] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [accountRefresh, setAccountRefresh] = useState(0);

  const market = useMemo(
    () => markets.find((item) => item.name === selectedCoin) || null,
    [markets, selectedCoin]
  );
  const context = market ? contexts[market.index] : null;
  const exchangeClient = useMemo(() => {
    if (!address || !networkReady || typeof window === 'undefined' || !window.ethereum) return null;
    const wallet = createWalletClient({
      account: address,
      chain: arbitrumSepolia,
      transport: custom(window.ethereum)
    });
    return new ExchangeClient({
      transport,
      wallet,
      signatureChainId: HYPERLIQUID_TESTNET_CHAIN_ID
    });
  }, [address, networkReady]);
  const normalizedOrder = useMemo(() => {
    if (!market || !price || !size) return null;
    try {
      return { ...formatHyperliquidOrder(price, size, market.szDecimals), error: '' };
    } catch (error) {
      return { error: errorText(error) };
    }
  }, [market, price, size]);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const loadMarkets = async () => {
      if (busy) return;
      busy = true;
      try {
        const [meta, assetContexts] = await infoClient.metaAndAssetCtxs();
        if (cancelled) return;
        if (!Array.isArray(meta?.universe) || !Array.isArray(assetContexts)) {
          throw new Error('Тестовая API вернула метаданные рынка в неожиданном формате.');
        }
        const nextMarkets = meta.universe.flatMap((item, index) => (
          typeof item?.name === 'string' && Number.isInteger(item.szDecimals)
            ? [{ name: item.name, szDecimals: item.szDecimals, maxLeverage: item.maxLeverage, index }]
            : []
        ));
        setMarkets(nextMarkets);
        setContexts(assetContexts);
        setSelectedCoin((current) => (
          nextMarkets.some((item) => item.name === current)
            ? current
            : nextMarkets.find((item) => item.name === 'BTC')?.name || nextMarkets[0]?.name || ''
        ));
        setMarketUpdatedAt(Date.now());
        setMarketError('');
      } catch (error) {
        if (!cancelled) setMarketError(errorText(error));
      } finally {
        busy = false;
      }
    };
    loadMarkets();
    const interval = window.setInterval(loadMarkets, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedCoin) return undefined;
    let cancelled = false;
    let busy = false;
    const loadBook = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await infoClient.l2Book({ coin: selectedCoin });
        if (!cancelled) {
          setBook(result);
          setBookError('');
        }
      } catch (error) {
        if (!cancelled) setBookError(errorText(error));
      } finally {
        busy = false;
      }
    };
    loadBook();
    const interval = window.setInterval(loadBook, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedCoin]);

  useEffect(() => {
    if (!address) {
      setAccount(null);
      setOpenOrders([]);
      setHistory([]);
      setAccountError('');
      return undefined;
    }
    let cancelled = false;
    try {
      setHistory(readHyperliquidOrderHistory(window.localStorage, address));
      setStorageError('');
    } catch (error) {
      setStorageError(errorText(error));
    }
    const loadAccount = async () => {
      try {
        const [state, orders] = await Promise.all([
          infoClient.clearinghouseState({ user: address }),
          infoClient.openOrders({ user: address })
        ]);
        if (!cancelled) {
          setAccount(state);
          setOpenOrders(orders);
          setAccountError('');
        }
      } catch (error) {
        if (!cancelled) setAccountError(errorText(error));
      }
    };
    loadAccount();
    const interval = window.setInterval(loadAccount, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [address, accountRefresh]);

  useEffect(() => {
    const provider = typeof window !== 'undefined' ? window.ethereum : null;
    if (!provider?.on) return undefined;
    const onAccountsChanged = (accounts) => {
      const next = Array.isArray(accounts) && accounts[0] ? getAddress(accounts[0]) : '';
      setAddress(next);
      setNetworkReady(false);
    };
    const onChainChanged = (chainId) => {
      setNetworkReady(chainId?.toLowerCase() === HYPERLIQUID_TESTNET_CHAIN_ID);
    };
    provider.on('accountsChanged', onAccountsChanged);
    provider.on('chainChanged', onChainChanged);
    return () => {
      provider.removeListener?.('accountsChanged', onAccountsChanged);
      provider.removeListener?.('chainChanged', onChainChanged);
    };
  }, []);

  const refreshAccount = useCallback(() => setAccountRefresh((value) => value + 1), []);

  async function connectWallet() {
    setActionError('');
    setNotice('');
    const provider = typeof window !== 'undefined' ? window.ethereum : null;
    if (!provider?.request) {
      setActionError('Не найден EVM-кошелек с injected-провайдером. TON-кошелек для Hyperliquid не используется.');
      return;
    }
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || !accounts[0]) throw new Error('Кошелек не вернул адрес аккаунта.');
      const normalizedAddress = getAddress(accounts[0]);
      await ensureTestnetChain(provider);
      setAddress(normalizedAddress);
      setNetworkReady(true);
      setActionError('');
      setNotice('Подключен отдельный EVM-кошелек. Подпись и торговые действия останутся в его окне.');
    } catch (error) {
      setNetworkReady(false);
      setActionError(`Не удалось подключить testnet-кошелек: ${errorText(error)}`);
    }
  }

  function persistOrder(record) {
    try {
      setHistory(writeHyperliquidOrderHistory(window.localStorage, record));
      setStorageError('');
      return true;
    } catch (error) {
      setStorageError(errorText(error));
      return false;
    }
  }

  function startOrderReview(event) {
    event.preventDefault();
    if (!address || !networkReady || !exchangeClient) {
      setActionError('Подключите EVM-кошелек к Arbitrum Sepolia, чтобы подписывать testnet-заявки.');
      return;
    }
    if (storageError) {
      setActionError('Подписание отключено: сначала нужна рабочая локальная история ID для проверки результата.');
      return;
    }
    if (!market || !normalizedOrder || normalizedOrder.error) {
      setActionError(normalizedOrder?.error || 'Выберите рынок и укажите точные цену и размер.');
      return;
    }
    setActionError('');
    try {
      setReview({
        account: address,
        coin: market.name,
        assetId: market.index,
        side,
        price: normalizedOrder.price,
        size: normalizedOrder.size,
        notionalMicros: normalizedOrder.notionalMicros,
        cloid: createHyperliquidClientOrderId()
      });
    } catch (error) {
      setActionError(`Не удалось подготовить ID заявки: ${errorText(error)}`);
    }
  }

  async function submitReviewedOrder() {
    if (!review || !exchangeClient || review.account !== address || !networkReady) {
      setReview(null);
      setActionError('Аккаунт или сеть изменились. Проверьте заявку заново.');
      return;
    }
    setActionBusy(true);
    setActionError('');
    setNotice('');
    const record = {
      ...review,
      status: 'wallet-approval-pending',
      updatedAt: Date.now()
    };
    if (!persistOrder(record)) {
      setActionBusy(false);
      setReview(null);
      setActionError('Заявка не отправлена: не удалось сохранить ID до подписи.');
      return;
    }
    try {
      const response = await exchangeClient.order({
        orders: [{
          a: review.assetId,
          b: review.side === 'buy',
          p: review.price,
          s: review.size,
          r: false,
          t: { limit: { tif: 'Gtc' } },
          c: review.cloid
        }],
        grouping: 'na'
      });
      const result = resultStatus(response);
      const nextRecord = { ...record, status: result.kind, detail: result.detail, updatedAt: Date.now() };
      persistOrder(nextRecord);
      setNotice(`${result.detail} Ответ биржи — не доказательство полного исполнения; проверяйте статус и позицию.`);
      setReview(null);
      refreshAccount();
      try {
        await checkOrderStatus(review.cloid, review.account);
      } catch (error) {
        setActionError(`Заявка передана, но статус не удалось перепроверить: ${errorText(error)}. Не отправляйте повторно; проверьте ID ${review.cloid}.`);
      }
    } catch (error) {
      const denied = isWalletRejection(error);
      const status = denied ? 'wallet-rejected' : 'unknown';
      persistOrder({ ...record, status, detail: errorText(error), updatedAt: Date.now() });
      if (denied) {
        setNotice('Подпись отклонена в кошельке; бирже не отправлялась заявка.');
      } else {
        setActionError(`Результат отправки неизвестен. Не повторяйте заявку: сначала проверьте ID ${review.cloid} на тестовой бирже.`);
      }
      setReview(null);
      refreshAccount();
    } finally {
      setActionBusy(false);
    }
  }

  async function checkOrderStatus(cloid, user = address) {
    if (!user) return;
    setActionBusy(true);
    setActionError('');
    try {
      const result = await infoClient.orderStatus({ user, oid: cloid });
      if (result.status === 'unknownOid') {
        const existing = readHyperliquidOrderHistory(window.localStorage, user).find((item) => item.cloid === cloid);
        if (existing) persistOrder({ ...existing, status: 'unknown', detail: 'Биржа пока не находит ID; не повторяйте заявку, проверьте историю еще раз.', updatedAt: Date.now() });
        setNotice(`ID ${cloid} не найден в текущем ответе. Это не подтверждает отказ; не отправляйте дубликат.`);
      } else {
        const item = result.order.order;
        const status = result.order.status;
        const detail = `${status}: ${item.coin} ${item.side} ${item.sz} @ ${item.limitPx}.`;
        const existing = readHyperliquidOrderHistory(window.localStorage, user).find((entry) => entry.cloid === cloid);
        if (existing) persistOrder({ ...existing, status, detail, updatedAt: Date.now() });
        setNotice(`Проверка testnet: ${detail}`);
        refreshAccount();
      }
    } catch (error) {
      setActionError(`Статус не получен: ${errorText(error)}. Не отправляйте заявку повторно, пока не сверили ID ${cloid}.`);
    } finally {
      setActionBusy(false);
    }
  }

  async function cancelOpenOrder() {
    if (!cancelReview || !exchangeClient || !networkReady) return;
    const order = cancelReview;
    setActionBusy(true);
    setActionError('');
    setNotice('');
    try {
      const response = await exchangeClient.cancel({
        cancels: [{ a: order.asset, o: order.oid }]
      });
      const status = response?.response?.data?.statuses?.[0];
      if (status !== 'success') {
        throw new Error(typeof status?.error === 'string' ? status.error : 'Биржа не подтвердила отмену.');
      }
      setNotice(`Запрос отмены #${order.oid} принят. Обновите открытые заявки и убедитесь, что ордер снят.`);
      setCancelReview(null);
      refreshAccount();
    } catch (error) {
      setActionError(`Отмена не подтверждена: ${errorText(error)}. Проверьте статус ордера перед новой попыткой.`);
      setCancelReview(null);
    } finally {
      setActionBusy(false);
    }
  }

  const bids = book?.levels?.[0] || [];
  const asks = [...(book?.levels?.[1] || [])].reverse();
  const positions = account?.assetPositions || [];

  return (
    <section className="hl-panel" aria-label="Hyperliquid testnet">
      <div className="hl-title-row">
        <div>
          <small>Hyperliquid · Arbitrum Sepolia</small>
          <h2>Perpetuals <span className="hl-testnet-pill">TESTNET</span></h2>
        </div>
        <span className="hl-live-indicator"><i />Тестовая API</span>
      </div>
      <div className="hl-safety-note" role="note">
        Только тестовая сеть. Подписываются лимитные GTC-заявки до ${HYPERLIQUID_MAX_ORDER_NOTIONAL_USD} номинала отдельным EVM-кошельком. Не используется TON-кошелек, приватные ключи не читаются и не сохраняются. Тестнет не гарантирует безопасность, а торговля с плечом может привести к полной потере залога.
      </div>

      <div className="hl-market-toolbar">
        <label className="field-label">Рынок
          <select className="full-select" value={selectedCoin} onChange={(event) => {
            setSelectedCoin(event.target.value);
            setPrice('');
          }} disabled={markets.length === 0}>
            {markets.length === 0 && <option value="">Загружаем рынки…</option>}
            {markets.map((item) => <option key={item.name} value={item.name}>{item.name}-PERP</option>)}
          </select>
        </label>
        <div className="hl-mark-price">
          <span>Mark price</span>
          <strong>{formatNumber(context?.markPx ?? context?.midPx, 2)}</strong>
          <small>{marketUpdatedAt ? `Обновлено ${new Date(marketUpdatedAt).toLocaleTimeString('ru-RU')}` : 'Ожидание данных'}</small>
        </div>
        <div className="hl-market-metric">
          <span>Funding / 8h</span>
          <strong>{context?.funding == null ? '—' : `${formatNumber(Number(context.funding) * 100, 4)}%`}</strong>
        </div>
        <div className="hl-market-metric">
          <span>Open interest</span>
          <strong>{context?.openInterest == null ? '—' : formatNumber(context.openInterest, 2)}</strong>
        </div>
      </div>
      {marketError && <p className="inline-warning" role="alert">Не удалось загрузить рынки: {marketError}</p>}

      <div className="hl-trading-grid">
        <section className="hl-book" aria-label="Стакан Hyperliquid">
          <div className="hl-subheading">
            <h3>Книга заявок</h3>
            <span>{book?.time ? new Date(book.time).toLocaleTimeString('ru-RU') : 'Ожидание…'}</span>
          </div>
          <div className="hl-book-head"><span>Цена (USD)</span><span>Размер ({selectedCoin})</span></div>
          <div className="hl-book-levels">
            {asks.slice(0, 7).map((level, index) => (
              <button className="hl-book-level ask" type="button" key={`ask-${index}-${level.px}`} onClick={() => { setSide('buy'); setPrice(level.px); }}>
                <span>{formatNumber(level.px, 6)}</span><span>{formatNumber(level.sz, 5)}</span>
              </button>
            ))}
            {bids.slice(0, 7).map((level, index) => (
              <button className="hl-book-level bid" type="button" key={`bid-${index}-${level.px}`} onClick={() => { setSide('sell'); setPrice(level.px); }}>
                <span>{formatNumber(level.px, 6)}</span><span>{formatNumber(level.sz, 5)}</span>
              </button>
            ))}
            {!asks.length && !bids.length && <p className="muted">Ожидаем снимок книги заявок тестовой сети…</p>}
          </div>
          {bookError && <p className="inline-warning" role="alert">Книга не обновлена: {bookError}</p>}
        </section>

        <section className="hl-order-entry">
          <div className="hl-subheading"><h3>Лимитная заявка</h3><span>GTC · без market orders</span></div>
          <div className="hl-side-toggle" role="group" aria-label="Сторона ордера">
            <button type="button" className={side === 'buy' ? 'buy active' : 'buy'} aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>Buy / Long</button>
            <button type="button" className={side === 'sell' ? 'sell active' : 'sell'} aria-pressed={side === 'sell'} onClick={() => setSide('sell')}>Sell / Short</button>
          </div>
          <form onSubmit={startOrderReview}>
            <label className="field-label">Цена лимита (USD)
              <input className="full-input" type="text" inputMode="decimal" autoComplete="off" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Например, 62000" />
            </label>
            <label className="field-label">Размер ({selectedCoin || 'актив'})
              <input className="full-input" type="text" inputMode="decimal" autoComplete="off" value={size} onChange={(event) => setSize(event.target.value)} placeholder="Например, 0.001" />
            </label>
            <div className="hl-order-estimate">
              <span>Номинал после правил точности рынка</span>
              <strong>{normalizedOrder && !normalizedOrder.error
                ? `$${formatNumber((Number(normalizedOrder.notionalMicros) / 1_000_000).toString(), 2)}`
                : '—'}</strong>
            </div>
            {normalizedOrder?.error && <p className="inline-warning" role="alert">{normalizedOrder.error}</p>}
            <button className="primary-button hl-review-button" type="submit" disabled={!address || !networkReady || !normalizedOrder || Boolean(normalizedOrder.error) || Boolean(storageError)}>
              Проверить заявку
            </button>
          </form>
          <p className="fine-print">Цена/размер нормализуются форматтерами SDK по szDecimals рынка. Проверьте точные значения и номинал перед подписью. Комиссии и funding не включены в оценку.</p>
        </section>
      </div>

      <section className="hl-account">
        <div className="hl-subheading"><h3>Аккаунт и ордера</h3>
          {address ? (
            <span className={networkReady ? 'hl-connected' : 'hl-disconnected'}>{shortAddress(address)} · {networkReady ? 'Arbitrum Sepolia' : 'неверная сеть'}</span>
          ) : <span>кошелек не подключен</span>}
        </div>
        {!address && <button className="secondary-button hl-connect-button" type="button" onClick={connectWallet}>Подключить EVM-кошелек</button>}
        {address && !networkReady && <button className="secondary-button hl-connect-button" type="button" onClick={connectWallet}>Переключить на Arbitrum Sepolia</button>}
        {address && networkReady && (
          <>
            <div className="hl-account-metrics">
              <div><span>Account value</span><strong>{account ? `$${formatNumber(account.marginSummary?.accountValue, 2)}` : '—'}</strong></div>
              <div><span>Withdrawable</span><strong>{account ? `$${formatNumber(account.withdrawable, 2)}` : '—'}</strong></div>
              <div><span>Margin used</span><strong>{account ? `$${formatNumber(account.marginSummary?.totalMarginUsed, 2)}` : '—'}</strong></div>
            </div>
            {accountError && <p className="inline-warning" role="alert">Данные аккаунта не обновлены: {accountError}</p>}
            {account && positions.length > 0 && <div className="hl-position-list">
              <strong>Позиции</strong>
              {positions.map(({ position }) => (
                <div className="hl-position-row" key={position.coin}>
                  <span>{position.coin} · {position.szi} · {position.leverage.value}x</span>
                  <span>UPnL ${formatNumber(position.unrealizedPnl, 2)} · liq {position.liquidationPx ?? '—'}</span>
                </div>
              ))}
            </div>}
            <div className="hl-open-orders">
              <div className="hl-subheading"><h4>Открытые заявки</h4><button className="text-button" type="button" onClick={refreshAccount}>Обновить</button></div>
              {openOrders.length === 0
                ? <p className="muted">Открытых заявок не найдено.</p>
                : openOrders.map((order) => {
                  const asset = markets.find((item) => item.name === order.coin);
                  return (
                    <div className="hl-open-order" key={order.oid}>
                      <span><strong>{order.coin} {order.side}</strong><small>{order.sz} @ {order.limitPx} · #{order.oid}</small></span>
                      <button className="text-button" type="button" disabled={actionBusy || !asset} onClick={() => setCancelReview({ oid: order.oid, asset: asset.index, coin: order.coin, side: order.side, size: order.sz, price: order.limitPx })}>Отменить</button>
                    </div>
                  );
                })}
            </div>
            {history.length > 0 && <div className="hl-local-history">
              <div className="hl-subheading"><h4>Локальные ID отправок</h4><small>Без секретов; до 50 последних</small></div>
              {history.slice(0, 5).map((record) => (
                <div className="hl-history-row" key={record.cloid}>
                  <span><strong>{record.coin} {record.side} · {record.status}</strong><code>{record.cloid}</code></span>
                  <button className="text-button" type="button" disabled={actionBusy} onClick={() => checkOrderStatus(record.cloid)}>Проверить ID</button>
                </div>
              ))}
            </div>}
            {storageError && <p className="inline-warning" role="alert">Локальная история недоступна: {storageError}. Отправка отключена.</p>}
          </>
        )}
      </section>

      {!address && <p className="hl-onboarding">
        Кошелек нужен только для подписания тестовых заявок и запросов статуса. Для тестовых средств откройте{' '}
        <a href="https://app.hyperliquid-testnet.xyz/" target="_blank" rel="noreferrer">официальный Hyperliquid testnet</a>;
        {' '}не переводите реальные средства через это приложение.
      </p>}

      {(notice || actionError) && <div className={actionError ? 'hl-action-message error' : 'hl-action-message'} role={actionError ? 'alert' : 'status'}>{actionError || notice}</div>}

      {review && <div className="hl-confirm" role="group" aria-label="Подтверждение тестовой заявки">
        <div className="hl-subheading"><h3>Проверьте перед подписью</h3><span>только testnet</span></div>
        <div className="hl-confirm-grid">
          <span>Сторона</span><strong>{review.side === 'buy' ? 'Buy / Long' : 'Sell / Short'} {review.coin}</strong>
          <span>Цена · размер</span><strong>{review.price} USD · {review.size} {review.coin}</strong>
          <span>Номинал · тип</span><strong>${formatNumber((Number(review.notionalMicros) / 1_000_000).toString(), 2)} · GTC limit</strong>
          <span>Client order ID</span><code>{review.cloid}</code>
        </div>
        <p className="fine-print">После подписи заявка может исполниться полностью или частично. GTC-остаток останется открыт. Не подписывайте, если цена, размер или сеть не совпадают с вашими намерениями.</p>
        <div className="hl-confirm-actions">
          <button className="secondary-button" type="button" disabled={actionBusy} onClick={() => setReview(null)}>Назад</button>
          <button className="primary-button" type="button" disabled={actionBusy} onClick={submitReviewedOrder}>{actionBusy ? 'Ожидаем кошелек…' : 'Подписать и отправить'}</button>
        </div>
      </div>}

      {cancelReview && <div className="hl-confirm" role="group" aria-label="Подтверждение отмены заявки">
        <div className="hl-subheading"><h3>Отменить заявку?</h3><span>testnet</span></div>
        <p className="fine-print">{cancelReview.coin} {cancelReview.side} · {cancelReview.size} @ {cancelReview.price} · #{cancelReview.oid}</p>
        <div className="hl-confirm-actions">
          <button className="secondary-button" type="button" disabled={actionBusy} onClick={() => setCancelReview(null)}>Назад</button>
          <button className="primary-button" type="button" disabled={actionBusy} onClick={cancelOpenOrder}>{actionBusy ? 'Ожидаем кошелек…' : 'Подтвердить отмену'}</button>
        </div>
      </div>}
    </section>
  );
}
