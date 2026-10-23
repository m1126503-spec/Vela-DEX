import { useState } from 'react';
import { PLATFORM_WALLET_ADDRESS } from '../config';
import { formatTokenAmount } from '../lib/stonSwap';

export default function WalletPanel({
  wallet,
  walletAddress,
  walletData,
  isMainnet,
  transferAmount,
  setTransferAmount,
  transferDialogOpen,
  setTransferDialogOpen,
  transferPending,
  onRefresh,
  onSubmitTransfer,
  setNotice
}) {
  return (
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
            <button className="text-button" type="button" disabled={walletData.loading} onClick={onRefresh}>Обновить</button>
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
          <button className="secondary-button" type="button" disabled={!isMainnet || !transferAmount} onClick={() => setTransferDialogOpen(true)}>Проверить перевод</button>
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
  );
}
