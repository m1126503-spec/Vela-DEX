import { useEffect, useState } from 'react';

const COINS = [
  { symbol: 'TON', name: 'Toncoin', id: 'the-open-network' },
  { symbol: 'NOT', name: 'Notcoin', id: 'notcoin' },
  { symbol: 'USDT', name: 'Tether', id: 'tether' },
  { symbol: 'STON', name: 'STON.fi', id: 'ston-2' },
  { symbol: 'DOGS', name: 'Dogs', id: 'dogs-2' }
];

const IDS = COINS.map((c) => c.id).join(',');
const API = `https://api.coingecko.com/api/v3/simple/price?ids=${IDS}&vs_currencies=usd&include_24hr_change=true`;

export default function MarketsList({ onSelect, activeSymbol }) {
  const [markets, setMarkets] = useState(
    COINS.map((c) => ({ ...c, price: null, change: null }))
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      setError('');
      const res = await fetch(API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMarkets(
        COINS.map((c) => {
          const entry = data[c.id] || {};
          return {
            ...c,
            price: typeof entry.usd === 'number' ? entry.usd : null,
            change: typeof entry.usd_24h_change === 'number' ? entry.usd_24h_change : null
          };
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="markets-list">
      <div className="markets-header">
        <span>Рынки</span>
        <span className="muted">{loading ? '…' : error ? 'ошибка' : 'CoinGecko'}</span>
      </div>
      {error && !markets.some((m) => m.price != null) && (
        <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--color-warn)' }}>
          Не удалось загрузить цены. {error}
        </div>
      )}
      {markets.map((m) => {
        const isUp = (m.change ?? 0) >= 0;
        const isActive = activeSymbol === m.symbol;
        const priceText = m.price == null
          ? '—'
          : m.price < 0.01
            ? m.price.toFixed(6)
            : m.price.toFixed(m.price < 1 ? 4 : 3);
        return (
          <button
            type="button"
            key={m.symbol}
            className={`market-row${isActive ? ' active' : ''}`}
            onClick={() => onSelect?.(m.symbol)}
          >
            <div className="market-left">
              <div className="market-symbol">{m.symbol}<span>/USDT</span></div>
              <div className="market-name">{m.name}</div>
            </div>
            <div className="market-right">
              <div className="market-price">{priceText}</div>
              <div className={`market-change ${m.change == null ? '' : isUp ? 'up' : 'down'}`}>
                {m.change == null ? '—' : `${isUp ? '+' : ''}${m.change.toFixed(2)}%`}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
