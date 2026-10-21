import { useEffect, useState } from 'react';
import {
  TonConnectButton,
  useTonAddress,
  useTonConnectUI,
  useTonWallet
} from '@tonconnect/ui-react';
import { APP_NAME, PLATFORM_WALLET_ADDRESS, TELEGRAM_BOT_USERNAME } from './config';
import SwapPanel from './components/SwapPanel';
import PoolPanel from './components/PoolPanel';
import { fetchWalletEvents, fetchWalletJettons, fetchWalletTonBalance } from './lib/tonApi';
import { formatTokenAmount } from './lib/stonSwap';

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
        <strong>STON.FI · MAINNET</strong>
        <span>Свапы исполняются on-chain через подключенный TON-кошелек. Каждая транзакция требует подписи.</span>
      </div>
      {!wallet && <div className="muted network-note">Подключите кошелек, чтобы увидеть реальные балансы и подписывать свапы.</div>}
      {wallet && !isMainnet && <div className="inline-warning">Кошелек подключен к testnet. Свапы доступны только через STON.fi в TON mainnet.</div>}
      {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Закрыть">×</button></div>}

      <nav className="tabs" aria-label="Разделы">
        {[['swap', 'Swap'], ['pools', 'Pools'], ['wallet', 'Wallet']].map(([key, label]) => (
          <button key={key} type="button" className={activeTab === key ? 'tab active' : 'tab'} onClick={() => setActiveTab(key)}>{label}</button>
        ))}
      </nav>

      {activeTab === 'swap' && (
        <SwapPanel
          wallet={wallet}
          walletAddress={walletAddress}
          walletData={walletData}
          onTransactionChange={refreshWalletData}
        />
      )}

      {activeTab === 'pools' && <PoolPanel />}

      {activeTab === 'wallet' && (
        <main className="card">
          <div className="section-heading"><div><small>TonConnect · TON mainnet</small><h2>Wallet</h2></div></div>
          <div className="wallet-summary">
            <div className="wallet-title">
              <strong>{wallet ? 'Кошелек подключен' : 'Кошелек не подключен'}</strong>
              <span className={`chip ${wallet && isMainnet ? 'live-chip' : ''}`}>{wallet ? (isMainnet ? 'MAINNET' : 'TESTNET') : 'DISCONNECTED'}</span>
            </div>
            {walletAddress && (
              <div className="address-value">
                <span>{walletAddress}</span>
                <button type="button" className="text-button" onClick={() => navigator.clipboard?.writeText(walletAddress).then(() => setNotice('Адрес скопирован.')).catch(() => setNotice('Не удалось скопировать адрес.'))}>Копировать</button>
              </div>
            )}
            {!wallet && <p className="fine-print">Подключите кошелек кнопкой сверху. Балансы и история будут загружены напрямую из сети через TonAPI.</p>}
          </div>

          {wallet && (
            <section className="live-section">
              <div className="subheading">
                <h3>Балансы из TON mainnet</h3>
                <button className="text-button" type="button" disabled={walletData.loading} onClick={refreshWalletData}>Обновить</button>
              </div>
              {walletData.loading && <p className="muted">Загружаем балансы TonAPI…</p>}
              {walletData.balance && (
                <div className="detail-row">
                  <span>TON · on-chain</span>
                  <strong>{formatTokenAmount(walletData.balance.balance || '0', 9)} TON</strong>
                </div>
              )}
              {walletData.jettons?.map((item) => {
                const jetton = item.jetton || item;
                const decimals = Number(jetton.decimals);
                const balance = /^\d+$/.test(String(item.balance)) ? item.balance : '0';
                return (
                  <div className="detail-row" key={jetton.address || jetton.symbol}>
                    <span>{jetton.symbol || 'Jetton'} · сеть</span>
                    <strong>{Number.isInteger(decimals) && decimals >= 0 && decimals <= 30 ? formatTokenAmount(balance, decimals) : 'Недоступно'}</strong>
                  </div>
                );
              })}
              {walletData.errors.map((error) => <p className="inline-warning" key={error}>Не удалось загрузить {error}; фальшивый баланс не подставляется.</p>)}
              {!walletData.loading && !walletData.balance && !walletData.errors.some((error) => error.startsWith('balance:')) && (
                <p className="muted">Баланс TON не получен.</p>
              )}
            </section>
          )}

          {wallet && (
            <section className="transfer-card">
              <h3>Добровольный перевод разработчику</h3>
              <p>Отдельный обычный TON-перевод на указанный адрес. Он не является комиссией за swap, не связан с успешностью обмена и не возвращается при отмене или ошибке свапа.</p>
              <label className="field-label">Сумма перевода (TON)
                <input className="full-input" inputMode="decimal" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} placeholder="0.01" />
              </label>
              <button className="secondary-button" type="button" disabled={!isMainnet || !parseTonAmount(transferAmount)} onClick={() => setTransferDialogOpen(true)}>Проверить перевод</button>
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
        </main>
      )}

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
    </div>
  );
}
