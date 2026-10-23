import { useEffect, useState, Suspense, lazy } from 'react';
import {
  TonConnectButton,
  useTonAddress,
  useTonConnectUI,
  useTonWallet
} from '@tonconnect/ui-react';
import { Analytics } from '@vercel/analytics/react';
import { APP_NAME, PLATFORM_WALLET_ADDRESS, TELEGRAM_BOT_USERNAME } from './config';
import { fetchWalletEvents, fetchWalletJettons, fetchWalletTonBalance } from './lib/tonApi';
import { formatTokenAmount } from './lib/stonSwap';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy-loaded panels
const SwapPanel = lazy(() => import('./components/SwapPanel'));
const PoolPanel = lazy(() => import('./components/PoolPanel'));
const FuturesPanel = lazy(() => import('./components/FuturesPanel'));
const WalletPanel = lazy(() => import('./components/WalletPanel'));

// Preload the default tab
const preloadSwap = () => import('./components/SwapPanel');

function PanelFallback() {
  return (
    <div className="card" style={{ minHeight: 280, padding: 20 }}>
      <div style={{ height: 28, width: '40%', background: 'var(--tg-theme-secondary-bg-color, #1e2937)', borderRadius: 6, marginBottom: 16 }} />
      <div style={{ height: 18, width: '70%', background: 'var(--tg-theme-secondary-bg-color, #1e2937)', borderRadius: 4, marginBottom: 12 }} />
      <div style={{ height: 48, background: 'var(--tg-theme-secondary-bg-color, #1e2937)', borderRadius: 8, marginBottom: 12 }} />
      <div style={{ height: 48, background: 'var(--tg-theme-secondary-bg-color, #1e2937)', borderRadius: 8 }} />
    </div>
  );
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

function transactionFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return `Перевод не подтвержден: ${message}`;
}

export default function App() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const walletAddress = useTonAddress();
  const [activeTab, setActiveTab] = useState('swap');
  const [notice, setNotice] = useState('');
  const [walletData, setWalletData] = useState({
    loading: false, balance: null, jettons: null, events: null, errors: []
  });
  const [walletDataRefresh, setWalletDataRefresh] = useState(0);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferPending, setTransferPending] = useState(false);
  const telegram = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
  const isMainnet = wallet?.account?.chain === '-239';

  // Preload default panel
  useEffect(() => {
    preloadSwap();
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem('vela-dex-demo-v1');
    } catch (error) {
      console.warn('Could not remove legacy demo state:', error);
    }
  }, []);

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

  async function submitVoluntaryTransfer() {
    const amount = parseTonAmount(transferAmount);
    if (!amount || !wallet || !isMainnet) {
      setNotice('Для перевода требуется mainnet-кошелек и корректная сумма TON (до 9 знаков после запятой).');
      return;
    }
    setTransferPending(true);
    try {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        network: '-239',
        messages: [{ address: PLATFORM_WALLET_ADDRESS, amount }]
      });
      setTransferDialogOpen(false);
      setNotice('Запрос отдельного перевода передан кошельку. Он не связан с обменом.');
      setWalletDataRefresh((value) => value + 1);
    } catch (error) {
      setNotice(transactionFailureMessage(error));
    } finally {
      setTransferPending(false);
    }
  }

  const refreshWalletData = () => setWalletDataRefresh((value) => value + 1);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div><small>Telegram Mini App · TON</small><h1>{APP_NAME}</h1></div>
        </div>
        <div className="wallet-block"><TonConnectButton /></div>
      </header>

      <div className="network-banner">
        <strong>{activeTab === 'futures' ? 'PERPS · PREVIEW' : 'STON.FI · MAINNET'}</strong>
        <span>{activeTab === 'futures'
          ? 'Калькулятор фьючерсов не подключен к торговому протоколу; заявки не исполняются.'
          : 'Свапы исполняются on-chain через подключенный TON-кошелек. Каждая транзакция требует подписи.'}</span>
      </div>
      {!wallet && <div className="muted network-note">{activeTab === 'futures'
        ? 'Подключите mainnet-кошелек, чтобы видеть доступный баланс USDT.'
        : 'Подключите кошелек, чтобы увидеть реальные балансы и подписывать свапы.'}</div>}
      {wallet && !isMainnet && <div className="inline-warning">{activeTab === 'futures'
        ? 'Подключен testnet-кошелек. Для отображения доступного USDT используется только mainnet.'
        : 'Кошелек подключен к testnet. Свапы доступны только через STON.fi в TON mainnet.'}</div>}
      {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Закрыть">×</button></div>}

      <nav className="tabs" aria-label="Разделы">
        {[['swap', 'Swap'], ['pools', 'Pools'], ['futures', 'Futures'], ['wallet', 'Wallet']].map(([key, label]) => (
          <button key={key} type="button" className={activeTab === key ? 'tab active' : 'tab'} onClick={() => setActiveTab(key)}>{label}</button>
        ))}
      </nav>

      <ErrorBoundary>
        <Suspense fallback={<PanelFallback />}>
          {activeTab === 'swap' && (
            <SwapPanel
              wallet={wallet}
              walletAddress={walletAddress}
              walletData={walletData}
              onTransactionChange={refreshWalletData}
            />
          )}

          {activeTab === 'pools' && <PoolPanel />}

          {activeTab === 'futures' && (
            <FuturesPanel
              wallet={wallet}
              walletData={walletData}
              onOpenSwap={() => setActiveTab('swap')}
            />
          )}

          {activeTab === 'wallet' && (
            <WalletPanel
              wallet={wallet}
              walletAddress={walletAddress}
              walletData={walletData}
              isMainnet={isMainnet}
              transferAmount={transferAmount}
              setTransferAmount={setTransferAmount}
              transferDialogOpen={transferDialogOpen}
              setTransferDialogOpen={setTransferDialogOpen}
              transferPending={transferPending}
              onRefresh={refreshWalletData}
              onSubmitTransfer={submitVoluntaryTransfer}
              setNotice={setNotice}
            />
          )}
        </Suspense>
      </ErrorBoundary>

      {transferDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
            <div className="modal-header">
              <h3 id="transfer-title">Подтвердите отдельный перевод</h3>
              <button type="button" className="close-button" onClick={() => setTransferDialogOpen(false)} aria-label="Закрыть">×</button>
            </div>
            <div className="transfer-confirm">
              <div><span>Сумма</span><strong>{transferAmount} TON</strong></div>
              <div><span>Получатель</span><strong className="mono">{PLATFORM_WALLET_ADDRESS}</strong></div>
            </div>
            <p className="inline-warning">Добровольный перевод через TonConnect. Это не комиссия за swap и не часть обмена. После подтверждения в кошельке он не возвращается при неудаче или отмене swap.</p>
            <button type="button" className="primary-button" disabled={transferPending || !isMainnet} onClick={submitVoluntaryTransfer}>
              {transferPending ? 'Ожидание кошелька…' : 'Я согласен — открыть TonConnect'}
            </button>
          </div>
        </div>
      )}

      <footer className="app-footer">
        Vela DEX · STON.fi · TON mainnet ·{' '}
        <a href={`https://t.me/${TELEGRAM_BOT_USERNAME.replace(/^@/, '')}`} target="_blank" rel="noreferrer">Telegram</a>
      </footer>
      <Analytics />
    </div>
  );
}
