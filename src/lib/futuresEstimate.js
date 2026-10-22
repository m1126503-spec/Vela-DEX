const DECIMAL_AMOUNT = /^\d+(?:[.,]\d+)?$/;
const ORDER_TYPES = new Set(['market', 'limit', 'stop']);

function parsePositiveAmount(value) {
  if (typeof value !== 'string' || !DECIMAL_AMOUNT.test(value.trim())) return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function calculateFuturesEstimate({
  margin,
  price,
  leverage,
  side,
  orderType,
  availableBalance
}) {
  const marginUsd = parsePositiveAmount(margin);
  if (marginUsd === null) {
    return { error: 'Введите сумму маржи больше нуля.' };
  }

  const referencePrice = parsePositiveAmount(price);
  if (referencePrice === null) {
    return { error: 'Введите оценочную цену актива больше нуля.' };
  }

  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 50) {
    return { error: 'Плечо должно быть от 1x до 50x.' };
  }

  if (side !== 'long' && side !== 'short') {
    return { error: 'Выберите Long или Short.' };
  }

  if (!ORDER_TYPES.has(orderType)) {
    return { error: 'Выберите тип ордера.' };
  }

  if (availableBalance !== null
    && availableBalance !== undefined
    && (!Number.isFinite(availableBalance) || availableBalance < 0)) {
    return { error: 'Баланс USDT недоступен для проверки.' };
  }

  if (availableBalance !== null
    && availableBalance !== undefined
    && marginUsd > availableBalance) {
    return { error: 'Сумма маржи превышает доступный баланс USDT.' };
  }

  const positionUsd = marginUsd * leverage;
  const assetQuantity = positionUsd / referencePrice;
  if (!Number.isFinite(positionUsd) || !Number.isFinite(assetQuantity)) {
    return { error: 'Не удалось рассчитать размер позиции.' };
  }

  return {
    marginUsd,
    positionUsd,
    assetQuantity,
    adverseMovePercent: 100 / leverage
  };
}
