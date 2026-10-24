import { useEffect, useState } from 'react';

// Simple visual chart. In a real perps app this would be fed by a price feed.
export default function PriceChart({ symbol = 'TON', basePrice = 5.42 }) {
  const [price, setPrice] = useState(basePrice);
  const [change, setChange] = useState(0);
  const [bars, setBars] = useState(() =>
    Array.from({ length: 24 }, () => Math.random() * 0.8 + 0.2)
  );

  useEffect(() => {
    const id = setInterval(() => {
      setPrice((prev) => {
        const delta = (Math.random() - 0.48) * 0.015;
        const next = Math.max(0.1, prev * (1 + delta));
        setChange(((next - basePrice) / basePrice) * 100);
        return next;
      });
      setBars((prev) => {
        const next = [...prev.slice(1), Math.random() * 0.75 + 0.25];
        return next;
      });
    }, 2800);
    return () => clearInterval(id);
  }, [basePrice]);

  const isUp = change >= 0;

  return (
    <div className="price-chart">
      <div className="price-chart-header">
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 2 }}>
            {symbol}/USDT · 15m
          </div>
          <div className="price-chart-price">
            ${price.toFixed(3)}
          </div>
        </div>
        <div className={`price-chart-change ${isUp ? 'up' : 'down'}`}>
          {isUp ? '+' : ''}{change.toFixed(2)}%
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
        Демо-график · не торговая котировка
      </div>
    </div>
  );
}
