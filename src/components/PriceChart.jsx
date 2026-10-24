import { useEffect, useState } from 'react';

const ID_MAP = {
  TON: 'the-open-network',
  NOT: 'notcoin',
  USDT: 'tether',
  STON: 'ston-2',
  DOGS: 'dogs-2'
};

export default function PriceChart({ symbol = 'TON' }) {
  const [price, setPrice] = useState(null);
  const [change, setChange] = useState(null);
  const [bars, setBars] = useState(() =>
    Array.from({ length: 24 }, () => Math.random() * 0.7 + 0.25)
  );

  useEffect(() => {
    const id = ID_MAP[symbol] || ID_MAP.TON;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`
        );
        if (!res.ok) return;
        const data = await res.json();
        const entry = data[id];
        if (!cancelled && entry) {
          setPrice(typeof entry.usd === 'number' ? entry.usd : null);
          setChange(typeof entry.usd_24h_change === 'number' ? entry.usd_24h_change : null);
        }
      } catch {
        /* keep previous */
      }
    }

    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol]);

  // Lightweight visual bars that gently move while real price is shown
  useEffect(() => {
    const id = setInterval(() => {
      setBars((prev) => [...prev.slice(1), Math.random() * 0.65 + 0.3]);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const isUp = (change ?? 0) >= 0;
  const priceText = price == null
    ? '—'
    : price < 0.01
      ? price.toFixed(6)
      : price.toFixed(price < 1 ? 4 : 3);

  return (
    <div className="price-chart">
      <div className="price-chart-header">
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 2 }}>
            {symbol}/USDT · CoinGecko
          </div>
          <div className="price-chart-price">${priceText}</div>
        </div>
        <div className={`price-chart-change ${change == null ? '' : isUp ? 'up' : 'down'}`}>
          {change == null ? '—' : `${isUp ? '+' : ''}${change.toFixed(2)}%`}
        </div>
      </div>
      <div className="chart-bars" aria-hidden="true">
        {bars.map((h, i) => (
          <div
            key={i}
            className={`chart-bar ${i > bars.length - 4 ? (isUp ? 'up' : 'down') : ''}`}
            style={{ height: `${h * 100}%` }}
          />
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-faint)', marginTop: 6, textAlign: 'right' }}>
        Цена с CoinGecko · график визуальный
      </div>
    </div>
  );
}
