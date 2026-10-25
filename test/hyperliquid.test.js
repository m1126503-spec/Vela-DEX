import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHyperliquidClientOrderId,
  formatHyperliquidOrder,
  HYPERLIQUID_MAX_ORDER_NOTIONAL_USD,
  HYPERLIQUID_ORDER_STORAGE_KEY,
  readHyperliquidOrderHistory,
  writeHyperliquidOrderHistory
} from '../src/lib/hyperliquid.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
}

test('formats order values with Hyperliquid precision and exact decimal notional', () => {
  const order = formatHyperliquidOrder('67000.23', '0.001234567', 5);
  assert.equal(order.price, '67000');
  assert.equal(order.size, '0.00123');
  assert.equal(order.notionalMicros, 82_410_000n);
});

test('rejects invalid decimals, sizes rounded to zero, and notional above the test cap', () => {
  assert.throws(() => formatHyperliquidOrder('1e3', '0.1', 3), /положительное число/);
  assert.throws(() => formatHyperliquidOrder('10', '0.0001', 3), /too small|zero/i);
  assert.throws(
    () => formatHyperliquidOrder('100000', '0.003', 3),
    new RegExp(`Лимит тестового ордера — \\$${HYPERLIQUID_MAX_ORDER_NOTIONAL_USD}`)
  );
});

test('generates a 16-byte client order id in Hyperliquid format', () => {
  const cloid = createHyperliquidClientOrderId({ randomUUID: () => '01234567-89ab-cdef-0123-456789abcdef' });
  assert.equal(cloid, '0x0123456789abcdef0123456789abcdef');
});

test('stores only account-scoped order tracking metadata', () => {
  const storage = memoryStorage();
  const record = {
    account: '0xAbCd',
    cloid: '0x0123456789abcdef0123456789abcdef',
    coin: 'BTC',
    side: 'buy',
    status: 'unknown',
    updatedAt: 1
  };

  writeHyperliquidOrderHistory(storage, record);
  assert.equal(readHyperliquidOrderHistory(storage, '0xabcd')[0].cloid, record.cloid);
  assert.equal(readHyperliquidOrderHistory(storage, '0xother').length, 0);
  assert.equal(storage.getItem(HYPERLIQUID_ORDER_STORAGE_KEY).includes('privateKey'), false);
});
