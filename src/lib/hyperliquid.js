import { formatPrice, formatSize } from '@nktkas/hyperliquid/utils';

export const HYPERLIQUID_TESTNET_CHAIN_ID = '0x66eee';
export const HYPERLIQUID_MAX_ORDER_NOTIONAL_USD = 250;
export const HYPERLIQUID_ORDER_STORAGE_KEY = 'vela-hyperliquid-testnet-orders-v1';

function decimalToMicros(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error('Используйте положительное число с точкой, без разделителей тысяч.');
  }

  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > 6) throw new Error('После форматирования рынка осталось больше 6 знаков после точки.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0');
}

export function formatHyperliquidOrder(priceInput, sizeInput, sizeDecimals) {
  if (!Number.isInteger(sizeDecimals) || sizeDecimals < 0 || sizeDecimals > 6) {
    throw new Error('Для рынка получено недопустимое число знаков размера.');
  }
  for (const value of [priceInput, sizeInput]) {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,30})?$/.test(value)) {
      throw new Error('Используйте положительное число с точкой, без разделителей тысяч или экспоненты.');
    }
  }
  const price = formatPrice(priceInput, sizeDecimals);
  const size = formatSize(sizeInput, sizeDecimals);
  const priceMicros = decimalToMicros(price);
  const sizeMicros = decimalToMicros(size);

  if (priceMicros <= 0n || sizeMicros <= 0n) {
    throw new Error('Цена и размер должны быть больше нуля после округления до шага рынка.');
  }

  const maximumMicros = BigInt(HYPERLIQUID_MAX_ORDER_NOTIONAL_USD) * 1_000_000n;
  const notionalProduct = priceMicros * sizeMicros;
  if (notionalProduct > maximumMicros * 1_000_000n) {
    throw new Error(`Лимит тестового ордера — $${HYPERLIQUID_MAX_ORDER_NOTIONAL_USD} номинала.`);
  }

  return { price, size, notionalMicros: notionalProduct / 1_000_000n };
}

export function createHyperliquidClientOrderId(cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.randomUUID) throw new Error('Браузер не поддерживает безопасную генерацию ID ордера.');
  return `0x${cryptoApi.randomUUID().replaceAll('-', '')}`;
}

export function readHyperliquidOrderHistory(storage, account) {
  try {
    const records = JSON.parse(storage.getItem(HYPERLIQUID_ORDER_STORAGE_KEY) || '[]');
    if (!Array.isArray(records)) throw new Error('Неверный формат истории локальных ордеров.');
    return records.filter((record) => (
      record
      && record.account?.toLowerCase() === account?.toLowerCase()
      && /^0x[a-f0-9]{32}$/i.test(record.cloid)
      && typeof record.status === 'string'
    )).slice(0, 10);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Локальная история ордеров повреждена; не очищайте ее, пока не сверите открытые ордера.');
    throw error;
  }
}

export function writeHyperliquidOrderHistory(storage, record) {
  const existing = JSON.parse(storage.getItem(HYPERLIQUID_ORDER_STORAGE_KEY) || '[]');
  if (!Array.isArray(existing)) throw new Error('Неверный формат истории локальных ордеров.');
  const records = [record, ...existing.filter((item) => item.cloid !== record.cloid)].slice(0, 50);
  storage.setItem(HYPERLIQUID_ORDER_STORAGE_KEY, JSON.stringify(records));
  return records.filter((item) => item.account?.toLowerCase() === record.account.toLowerCase()).slice(0, 10);
}
