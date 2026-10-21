import { useEffect, useMemo, useRef, useState } from 'react';
import { useTonConnectUI } from '@tonconnect/ui-react';
import {
  fetchTransactionByMessageHash,
  fetchWalletJettons,
  fetchWalletTonBalance
} from '../lib/tonApi';
import {
  buildSwapTransaction,
  createSwapQueryId,
  formatTokenAmount,
  getExternalMessageHash,
  getWalletTokenBalance,
  lookupSwapStatus,
  normalizeAddress,
  parseTokenAmount,
  simulateSwap,
  SLIPPAGE_OPTIONS,
  SUPPORTED_TOKENS,
  toSlippagePercent
} from '../lib/stonSwap';

const SWAP_HISTORY_KEY = 'vela-onchain-swaps-v1';
const MAINNET_CHAIN = '-239';
const TON_GAS_BUFFER = 100_000_000n;
const MAX_STATUS_WAIT_MS = 10 * 60 * 1000;

function loadSwapHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(SWAP_HISTORY_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter((item) => item
      && typeof item.id === 'string'
      && typeof item.queryId === 'string'
      && /^\d+$/.test(item.queryId)
      && normalizeAddress(item.routerAddress)
      && normalizeAddress(item.ownerAddress)
      && Number.isFinite(item.createdAt)
      && typeof item.fromSymbol === 'string'
      && typeof item.toSymbol === 'string'
      && typeof item.fromAmount === 'string'
      && typeof item.expectedAmount === 'string'
      && typeof item.minimumAmount === 'string'
      && (!item.messageHash || /^[A-Fa-f0-9]{64}$/.test(item.messageHash)))
      .slice(0, 20)
      .map((item) => ({
        ...item,
        status: 'pending',
        txHash: '',
        walletTxHash: '',
        exitCode: '',
        error: '',
        statusCheckError: ''
      }));
  } catch {
    return [];
  }
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('ru-RU');
}

function makeTonConnectTransaction(params) {
  if (!params?.to || !params?.body || BigInt(params.value) <= 0n) {
    throw new Error('SDK не вернул корректные параметры транзакции.');
  }
  return {
    validUntil: Math.floor(Date.now() / 1000) + 300,
    network: MAINNET_CHAIN,
    messages: [{
      address: params.to.toString(),
      amount: params.value.toString(),
      payload: params.body.toBoc().toString('base64')
    }]
  };
}

function sameQuote(first, second) {
  return first.offerUnits === second.offerUnits
    && first.askUnits === second.askUnits
    && first.minAskUnits === second.minAskUnits
    && first.routerAddress === second.routerAddress
    && normalizeAddress(first.router.address) === normalizeAddress(second.router.address)
    && normalizeAddress(first.router.ptonMasterAddress) === normalizeAddress(second.router.ptonMasterAddress)
    && first.router.majorVersion === second.router.majorVersion
    && first.router.minorVersion === second.router.minorVersion
    && first.poolAddress === second.poolAddress
    && first.offerJettonWallet === second.offerJettonWallet
    && first.askJettonWallet === second.askJettonWallet
    && normalizeAddress(first.feeAddress) === normalizeAddress(second.feeAddress)
    && first.feeUnits === second.feeUnits
    && first.feePercent === second.feePercent
    && first.slippageTolerance === second.slippageTolerance;
}

function statusLabel(swap) {
  if (swap.status === 'success') return 'Обмен подтвержден протоколом on-chain';
  if (swap.status === 'failed') return `Ошибка транзакции${swap.exitCode ? ` · exit code ${swap.exitCode}` : ''}`;
  if (swap.status === 'unknown') return 'Статус не подтвержден · проверьте в обозревателе';
  if (swap.walletTxHash) return 'Транзакция кошелька в сети · ожидаем результат DEX';
  return 'Отправлено кошельком · ожидаем подтверждение сети и DEX';
}

function feeDescription(quote, fromToken, toToken) {
  const feeToken = normalizeAddress(quote.feeAddress) === normalizeAddress(fromToken.address)
    ? fromToken
    : toToken;
  if (!quote.feeUnits || !/^\d+$/.test(quote.feeUnits)) return null;
  const percentage = Number(quote.feePercent);
  const percentText = Number.isFinite(percentage)
    ? ` (${(percentage * 100).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}%)`
    : '';
  return `${formatTokenAmount(quote.feeUnits, feeToken.decimals)} ${feeToken.symbol}${percentText}`;
}

export default function SwapPanel({ wallet, walletAddress, walletData, onTransactionChange }) {
  const [tonConnectUI] = useTonConnectUI();
  const [fromToken, setFromToken] = useState(SUPPORTED_TOKENS[0]);
  const [toToken, setToToken] = useState(SUPPORTED_TOKENS[1]);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(SLIPPAGE_OPTIONS[0].value);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [review, setReview] = useState(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState(loadSwapHistory);
  const [checkingId, setCheckingId] = useState('');
  const latestQuoteRequest = useRef(0);
  const checkLock = useRef(false);

  const amountUnits = useMemo(
    () => parseTokenAmount(amount, fromToken.decimals),
    [amount, fromToken]
  );
  const balanceUnits = getWalletTokenBalance(walletData, fromToken);
  const tonBalanceUnits = getWalletTokenBalance(walletData, SUPPORTED_TOKENS[0]);
  const isMainnet = wallet?.account?.chain === MAINNET_CHAIN;
  const hasValidBalance = balanceUnits !== null
    && amountUnits !== null
    && BigInt(amountUnits) <= BigInt(balanceUnits);

  useEffect(() => {
    try {
      localStorage.setItem(SWAP_HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      console.warn('Could not persist on-chain swap status:', error);
    }
  }, [history]);

  useEffect(() => {
    const requestId = ++latestQuoteRequest.current;
    setQuote(null);
    setQuoteError('');
    setReview(null);
    if (!amountUnits || fromToken.address === toToken.address) {
      setQuoteLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const nextQuote = await simulateSwap({
          fromToken,
          toToken,
          offerUnits: amountUnits,
          slippageTolerance: slippage
        });
        if (!cancelled && requestId === latestQuoteRequest.current) {
          setQuote({ ...nextQuote, receivedAt: Date.now() });
        }
      } catch (error) {
        if (!cancelled && requestId === latestQuoteRequest.current) {
          setQuoteError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled && requestId === latestQuoteRequest.current) setQuoteLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amountUnits, fromToken, slippage, toToken]);

  const pendingKey = history.filter((item) => item.status === 'pending').map((item) => item.id).join('|');

  async function refreshSwapStatus(swap) {
    const [walletResult, dexResult] = await Promise.allSettled([
      swap.messageHash ? fetchTransactionByMessageHash(swap.messageHash) : Promise.resolve(null),
      lookupSwapStatus({
        routerAddress: swap.routerAddress,
        ownerAddress: swap.ownerAddress,
        queryId: swap.queryId
      })
    ]);
    const update = { checkedAt: Date.now(), statusCheckError: '' };
    let walletTransactionFailed = false;
    if (walletResult.status === 'fulfilled' && walletResult.value) {
      const walletTransaction = walletResult.value;
      update.walletTxHash = walletTransaction.hash || swap.walletTxHash || '';
      if (walletTransaction.success === false || walletTransaction.aborted === true) {
        walletTransactionFailed = true;
        update.status = 'failed';
        update.error = 'Транзакция кошелька включена в сеть, но завершилась ошибкой.';
      }
    } else if (walletResult.status === 'rejected') {
      update.statusCheckError = walletResult.reason instanceof Error
        ? walletResult.reason.message
        : String(walletResult.reason);
    }

    if (dexResult.status === 'fulfilled' && dexResult.value?.['@type'] === 'Found') {
      update.txHash = dexResult.value.txHash || '';
      update.exitCode = String(dexResult.value.exitCode ?? '');
      const exitCode = Number(dexResult.value.exitCode);
      if (!Number.isInteger(exitCode)) {
        update.statusCheckError = 'STON.fi не вернул корректный код выполнения транзакции.';
      } else if (exitCode === 0 && !walletTransactionFailed) {
        update.status = 'success';
        update.error = '';
      } else {
        update.status = 'failed';
        if (!walletTransactionFailed) {
          update.error = `STON.fi сообщил exit code ${exitCode}. Проверьте транзакцию и возврат токенов в обозревателе.`;
        }
      }
    } else if (dexResult.status === 'rejected') {
      update.statusCheckError = [
        update.statusCheckError,
        dexResult.reason instanceof Error ? dexResult.reason.message : String(dexResult.reason)
      ].filter(Boolean).join(' · ');
    }

    if (!update.status && Date.now() - swap.createdAt >= MAX_STATUS_WAIT_MS) {
      update.status = 'unknown';
    }
    setHistory((current) => current.map((item) => item.id === swap.id ? { ...item, ...update } : item));
    if (update.status === 'success' || update.status === 'failed') onTransactionChange?.();
  }

  useEffect(() => {
    if (!pendingKey) return undefined;
    let running = false;
    const check = async () => {
      if (running || checkLock.current) return;
      running = true;
      checkLock.current = true;
      try {
        const pending = history.filter((item) => item.status === 'pending');
        await Promise.all(pending.map((swap) => refreshSwapStatus(swap)));
      } finally {
        running = false;
        checkLock.current = false;
      }
    };
    const timer = setInterval(check, 7000);
    check();
    return () => clearInterval(timer);
  }, [pendingKey]);

  async function prepareReview() {
    if (!walletAddress || !isMainnet || !hasValidBalance || !quote) return;
    setReviewLoading(true);
    setNotice('');
    try {
      const queryId = createSwapQueryId();
      const freshQuote = await simulateSwap({
        fromToken,
        toToken,
        offerUnits: amountUnits,
        slippageTolerance: slippage
      });
      const txParams = await buildSwapTransaction({
        quote: freshQuote,
        fromToken,
        toToken,
        walletAddress,
        queryId
      });
      if (tonBalanceUnits === null) {
        throw new Error('Не удалось проверить on-chain баланс TON для сетевой комиссии.');
      }
      const requiredTon = BigInt(txParams.value) + TON_GAS_BUFFER;
      if (BigInt(tonBalanceUnits) < requiredTon) {
        throw new Error(`Недостаточно TON для прикрепленной суммы и комиссии. Нужно около ${formatTokenAmount(requiredTon, 9)} TON.`);
      }
      setReview({ quote: freshQuote, txParams, queryId, fromToken, toToken, amountUnits, walletAddress });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setReviewLoading(false);
    }
  }

  async function confirmSwap() {
    if (!review || sending || !walletAddress || !isMainnet) return;
    if (review.walletAddress !== walletAddress) {
      setNotice('Подключенный кошелек изменился. Закройте окно и подготовьте транзакцию заново.');
      return;
    }
    setSending(true);
    setNotice('');
    try {
      const freshQuote = await simulateSwap({
        fromToken: review.fromToken,
        toToken: review.toToken,
        offerUnits: review.amountUnits,
        slippageTolerance: slippage
      });
      const freshParams = await buildSwapTransaction({
        quote: freshQuote,
        fromToken: review.fromToken,
        toToken: review.toToken,
        walletAddress,
        queryId: review.queryId
      });
      const [freshBalance, freshJettons] = await Promise.all([
        fetchWalletTonBalance(walletAddress),
        fetchWalletJettons(walletAddress)
      ]);
      const freshWalletData = {
        loading: false,
        balance: freshBalance,
        jettons: freshJettons,
        errors: []
      };
      const freshOfferBalance = getWalletTokenBalance(freshWalletData, review.fromToken);
      const freshTonBalance = getWalletTokenBalance(freshWalletData, SUPPORTED_TOKENS[0]);
      if (freshOfferBalance === null || BigInt(freshOfferBalance) < BigInt(review.amountUnits)) {
        throw new Error('Текущий баланс входного токена недостаточен или не удалось проверить его в сети.');
      }
      if (freshTonBalance === null
        || BigInt(freshTonBalance) < BigInt(freshParams.value) + TON_GAS_BUFFER) {
        throw new Error('Недостаточно TON для прикрепленной суммы и сетевого газа.');
      }
      if (!sameQuote(review.quote, freshQuote)
        || review.txParams.to.toRawString() !== freshParams.to.toRawString()
        || BigInt(review.txParams.value) !== BigInt(freshParams.value)) {
        setReview({ ...review, quote: freshQuote, txParams: freshParams });
        setNotice('Котировка или маршрут изменились. Проверьте обновленные сумму, минимум и маршрут и подтвердите еще раз.');
        return;
      }

      const response = await tonConnectUI.sendTransaction(makeTonConnectTransaction(freshParams));
      const now = Date.now();
      const messageHash = getExternalMessageHash(response?.boc);
      const swapRecord = {
        id: `${review.queryId}-${now}`,
        queryId: review.queryId,
        routerAddress: freshQuote.router.address,
        ownerAddress: walletAddress,
        messageHash,
        txHash: '',
        walletTxHash: '',
        status: 'pending',
        fromSymbol: review.fromToken.symbol,
        toSymbol: review.toToken.symbol,
        fromAmount: formatTokenAmount(freshQuote.offerUnits, review.fromToken.decimals),
        expectedAmount: formatTokenAmount(freshQuote.askUnits, review.toToken.decimals),
        minimumAmount: formatTokenAmount(freshQuote.minAskUnits, review.toToken.decimals),
        createdAt: now
      };
      setHistory((current) => [swapRecord, ...current].slice(0, 20));
      setReview(null);
      setNotice('TonConnect передал запрос кошельку. Отправка и исполнение еще проверяются в сети; статус будет обновляться автоматически.');
      onTransactionChange?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(`Транзакция не отправлена или не подтверждена кошельком: ${message}`);
    } finally {
      setSending(false);
    }
  }

  function changeToken(target, symbol) {
    const selected = SUPPORTED_TOKENS.find((token) => token.symbol === symbol);
    if (!selected) return;
    if (target === 'from') {
      if (selected.address === toToken.address) setToToken(fromToken);
      setFromToken(selected);
    } else {
      if (selected.address === fromToken.address) setFromToken(toToken);
      setToToken(selected);
    }
    setReview(null);
  }

  function flipTokens() {
    setFromToken(toToken);
    setToToken(fromToken);
    setReview(null);
  }

  const fee = quote ? feeDescription(quote, fromToken, toToken) : null;
  const displayedBalance = balanceUnits === null
    ? (walletData.loading ? 'Загрузка…' : 'Нет данных')
    : formatTokenAmount(balanceUnits, fromToken.decimals);
  const networkMessage = wallet && !isMainnet
    ? 'Подключен testnet-кошелек. STON.fi API котирует mainnet; переключите кошелек на TON mainnet.'
    : '';
  const canPrepare = Boolean(
    walletAddress
    && isMainnet
    && hasValidBalance
    && quote
    && !quoteLoading
    && !reviewLoading
    && !sending
  );

  return (
    <main className="card">
      <div className="section-heading">
        <div><small>STON.fi · TON mainnet</small><h2>Swap</h2></div>
        <span className="chip live-chip">ON-CHAIN</span>
      </div>
      <p className="fine-print swap-intro">Котировка и контрактный маршрут STON.fi. Средства перемещаются только после подписания транзакции в вашем кошельке.</p>

      {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Закрыть">×</button></div>}

      <div className="token-panel">
        <div className="panel-top">
          <span>Отдаете</span>
          <span>Баланс кошелька: {displayedBalance} {fromToken.symbol}</span>
        </div>
        <div className="amount-row">
          <input
            aria-label="Сумма отдаваемого токена"
            inputMode="decimal"
            type="text"
            autoComplete="off"
            value={amount}
            onChange={(event) => { setAmount(event.target.value); setReview(null); }}
            placeholder="0"
          />
          <select aria-label="Токен для обмена" value={fromToken.symbol} onChange={(event) => changeToken('from', event.target.value)}>
            {SUPPORTED_TOKENS.map((token) => <option key={token.symbol} value={token.symbol}>{token.symbol}</option>)}
          </select>
        </div>
      </div>

      <div className="swap-divider"><button className="icon-button" type="button" onClick={flipTokens} aria-label="Поменять токены местами">⇅</button></div>

      <div className="token-panel">
        <div className="panel-top"><span>Ожидаемый выход</span><span>{toToken.name}</span></div>
        <div className="amount-row">
          <div className="receive-value">
            {quote ? formatTokenAmount(quote.askUnits, toToken.decimals) : quoteLoading ? 'Котировка…' : '—'}
          </div>
          <select aria-label="Токен для получения" value={toToken.symbol} onChange={(event) => changeToken('to', event.target.value)}>
            {SUPPORTED_TOKENS.map((token) => <option key={token.symbol} value={token.symbol}>{token.symbol}</option>)}
          </select>
        </div>
      </div>

      <div className="swap-options">
        <label className="field-label">Проскальзывание
          <select value={slippage} onChange={(event) => { setSlippage(event.target.value); setReview(null); }}>
            {SLIPPAGE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="quote-status">{quoteLoading ? 'Обновляем котировку…' : quote ? `Котировка обновлена ${formatDate(quote.receivedAt)}` : 'Введите сумму для получения котировки'}</div>
      </div>

      {quote && (
        <div className="details-box">
          <div className="detail-row"><span>Маршрут</span><strong>STON.fi Router v{quote.router.majorVersion}.{quote.router.minorVersion}</strong></div>
          <div className="detail-row"><span>Минимум к получению</span><strong>{formatTokenAmount(quote.minAskUnits, toToken.decimals)} {toToken.symbol}</strong></div>
          <div className="detail-row"><span>Проскальзывание в транзакции</span><strong>{toSlippagePercent(quote.slippageTolerance)}</strong></div>
          {fee && <div className="detail-row"><span>Комиссия протокола (оценка)</span><strong>{fee}</strong></div>}
          {quote.gasParams?.estimatedGasConsumption && (
            <div className="detail-row"><span>Оценка сетевого газа</span><strong>{formatTokenAmount(quote.gasParams.estimatedGasConsumption, 9)} TON</strong></div>
          )}
        </div>
      )}

      {quoteError && <p className="inline-warning">{quoteError}</p>}
      {networkMessage && <p className="inline-warning">{networkMessage}</p>}
      {!wallet && <p className="inline-warning">Для on-chain обмена сначала подключите TON-кошелек.</p>}
      {wallet && isMainnet && balanceUnits === null && !walletData.loading && (
        <p className="inline-warning">Не удалось безопасно проверить реальный баланс {fromToken.symbol}; обмен отключен до успешной загрузки баланса.</p>
      )}
      {wallet && isMainnet && balanceUnits !== null && amountUnits && !hasValidBalance && (
        <p className="inline-warning">Сумма превышает доступный баланс {fromToken.symbol}.</p>
      )}
      {amount && !amountUnits && <p className="inline-warning">Введите корректную сумму с не более чем {fromToken.decimals} знаками после запятой.</p>}

      <button className="primary-button" type="button" disabled={!canPrepare} onClick={prepareReview}>
        {reviewLoading ? 'Получаем маршрут и готовим payload…' : 'Проверить swap'}
      </button>
      <p className="fine-print centered">Подписание откроется в Tonkeeper, MyTonWallet или другом подключенном кошельке. Никогда не подтверждайте транзакцию, детали которой отличаются от этого экрана.</p>

      <section className="history-section swap-history">
        <div className="subheading"><h3>On-chain swaps</h3><span className="chip live-chip">NETWORK</span></div>
        {history.length === 0 && <p className="muted">Отправленных свапов пока нет.</p>}
        {history.map((swap) => {
          const explorerHash = swap.txHash || swap.walletTxHash;
          const checkable = swap.status === 'pending' || swap.status === 'unknown';
          return (
            <article className="swap-status-item" key={swap.id}>
              <div className="swap-status-title">
                <strong>{swap.fromAmount} {swap.fromSymbol} → {swap.expectedAmount} {swap.toSymbol}</strong>
                <span className={`status-pill status-${swap.status}`}>{swap.status === 'success' ? 'УСПЕХ' : swap.status === 'failed' ? 'ОШИБКА' : swap.status === 'unknown' ? 'НЕИЗВЕСТНО' : 'ОЖИДАНИЕ'}</span>
              </div>
              <p>{statusLabel(swap)}</p>
              <small>Минимум: {swap.minimumAmount} {swap.toSymbol} · {formatDate(swap.createdAt)}</small>
              {swap.error && <small className="inline-warning">{swap.error}</small>}
              {swap.statusCheckError && <small className="muted">Проверка статуса: {swap.statusCheckError}</small>}
              {explorerHash && <a className="text-button explorer-link" href={`https://tonviewer.com/transaction/${encodeURIComponent(explorerHash)}`} target="_blank" rel="noreferrer">Открыть подтвержденную транзакцию ↗</a>}
              {checkable && <button className="text-button" type="button" disabled={checkingId === swap.id || checkLock.current} onClick={async () => {
                setCheckingId(swap.id);
                checkLock.current = true;
                try {
                  await refreshSwapStatus(swap);
                } finally {
                  checkLock.current = false;
                  setCheckingId('');
                }
              }}>{checkingId === swap.id ? 'Проверяем…' : 'Проверить статус в сети'}</button>}
            </article>
          );
        })}
      </section>

      {review && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="swap-review-title">
            <div className="modal-header">
              <h3 id="swap-review-title">Проверьте on-chain транзакцию</h3>
              <button type="button" className="close-button" onClick={() => !sending && setReview(null)} aria-label="Закрыть">×</button>
            </div>
            <div className="transfer-confirm">
              <div><span>Вы отдаете</span><strong>{formatTokenAmount(review.quote.offerUnits, review.fromToken.decimals)} {review.fromToken.symbol}</strong></div>
              <div><span>Ожидаемый выход</span><strong>{formatTokenAmount(review.quote.askUnits, review.toToken.decimals)} {review.toToken.symbol}</strong></div>
              <div><span>Минимум по slippage</span><strong>{formatTokenAmount(review.quote.minAskUnits, review.toToken.decimals)} {review.toToken.symbol} · {toSlippagePercent(review.quote.slippageTolerance)}</strong></div>
              <div><span>TON, прикрепленный к сообщению (включая gas budget)</span><strong>{formatTokenAmount(review.txParams.value.toString(), 9)} TON</strong></div>
              <div><span>Контракт STON.fi Router</span><strong className="mono">{review.quote.router.address}</strong></div>
              {review.quote.poolAddress && <div><span>Контракт пула</span><strong className="mono">{review.quote.poolAddress}</strong></div>}
              <div><span>Адрес назначения сообщения</span><strong className="mono">{review.txParams.to.toString()}</strong></div>
            </div>
            <p className="inline-warning">Подтверждение откроет кошелек и отправит одно SDK-собранное сообщение роутеру. Фактические сетевые комиссии взимаются блокчейном. Обмен может завершиться ошибкой; проверьте результат и возврат средств в сети.</p>
            <button type="button" className="primary-button" disabled={sending} onClick={confirmSwap}>
              {sending ? 'Обновляем котировку и ждем кошелек…' : 'Подтвердить и открыть кошелек'}
            </button>
            <button type="button" className="text-button cancel-review" disabled={sending} onClick={() => setReview(null)}>Отмена</button>
          </div>
        </div>
      )}
    </main>
  );
}
