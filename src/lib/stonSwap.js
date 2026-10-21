import { StonApiClient } from '@ston-fi/api';
import { Client, dexFactory } from '@ston-fi/sdk';
import { Address, Cell } from '@ton/ton';
import { Buffer } from 'buffer';
import { STON_API_BASE_URL, TON_RPC_URL } from '../config.js';

export const SLIPPAGE_OPTIONS = [
  { label: '0,5%', value: '0.005' },
  { label: '1%', value: '0.01' },
  { label: '2%', value: '0.02' }
];

export const SUPPORTED_TOKENS = [
  {
    symbol: 'TON',
    name: 'Toncoin',
    decimals: 9,
    kind: 'Ton',
    address: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
    apiAddress: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'
  },
  {
    symbol: 'USDT',
    name: 'Tether USD₮',
    decimals: 6,
    kind: 'Jetton',
    address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
    apiAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
  },
  {
    symbol: 'NOT',
    name: 'Notcoin',
    decimals: 9,
    kind: 'Jetton',
    address: '0:2f956143c461769579baef2e32cc2d7bc18283f40d20bb03e432cd603ac33ffc',
    apiAddress: 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT'
  }
];

let apiClient;
let tonClient;

export function getStonApiClient() {
  if (!apiClient) apiClient = new StonApiClient({ baseUrl: STON_API_BASE_URL });
  return apiClient;
}

function getTonClient() {
  if (!tonClient) tonClient = new Client({ endpoint: TON_RPC_URL });
  return tonClient;
}

export function normalizeAddress(address) {
  try {
    return Address.parse(address).toRawString();
  } catch {
    return null;
  }
}

export function parseTokenAmount(amount, decimals) {
  if (typeof amount !== 'string' || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    return null;
  }
  const match = amount.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length || 0) > decimals) return null;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] || '').padEnd(decimals, '0') || '0');
  const units = whole * (10n ** BigInt(decimals)) + fraction;
  return units > 0n ? units.toString() : null;
}

export function formatTokenAmount(units, decimals, maximumFractionDigits = decimals) {
  let value;
  try {
    value = BigInt(units);
  } catch {
    return '—';
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) return '—';
  const negative = value < 0n;
  if (negative) value = -value;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const visibleDigits = Math.min(decimals, Math.max(0, maximumFractionDigits));
  const fractionText = fraction.toString().padStart(decimals, '0').slice(0, visibleDigits).replace(/0+$/, '');
  const wholeText = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(whole);
  return `${negative ? '−' : ''}${wholeText}${fractionText ? `,${fractionText}` : ''}`;
}

export function getWalletTokenBalance(walletData, token) {
  if (!walletData || walletData.loading || !token) return null;
  if (token.kind === 'Ton') {
    if (!walletData.balance || walletData.errors.some((error) => error.startsWith('balance:'))) return null;
    try {
      return BigInt(walletData.balance.balance || '0').toString();
    } catch {
      return null;
    }
  }

  if (!Array.isArray(walletData.jettons) || walletData.errors.some((error) => error.startsWith('jettons:'))) {
    return null;
  }
  const targetAddress = normalizeAddress(token.address);
  const balance = walletData.jettons.find((item) => {
    const jettonAddress = normalizeAddress(item.jetton?.address || '');
    return jettonAddress && jettonAddress === targetAddress;
  })?.balance;
  try {
    return BigInt(balance || '0').toString();
  } catch {
    return null;
  }
}

export function toSlippagePercent(fraction) {
  const value = Number(fraction) * 100;
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;
}

export async function simulateSwap({ fromToken, toToken, offerUnits, slippageTolerance }) {
  const result = await getStonApiClient().simulateSwap({
    offerAddress: fromToken.apiAddress,
    askAddress: toToken.apiAddress,
    offerUnits,
    slippageTolerance,
    dexV2: true
  });

  const expectedOffer = normalizeAddress(fromToken.address);
  const expectedAsk = normalizeAddress(toToken.address);
  const routerAddress = normalizeAddress(result?.router?.address);
  const responseRouterAddress = normalizeAddress(result?.routerAddress);
  const ptonAddress = normalizeAddress(result?.router?.ptonMasterAddress);
  if (!result?.router
    || !expectedOffer
    || !expectedAsk
    || !routerAddress
    || !ptonAddress
    || normalizeAddress(result.offerAddress) !== expectedOffer
    || normalizeAddress(result.askAddress) !== expectedAsk
    || routerAddress !== responseRouterAddress
    || result.offerUnits !== offerUnits
    || !/^\d+$/.test(result.askUnits)
    || !/^\d+$/.test(result.minAskUnits)
    || BigInt(result.askUnits) <= 0n
    || BigInt(result.minAskUnits) <= 0n
    || BigInt(result.minAskUnits) > BigInt(result.askUnits)
    || !/^\d+$/.test(result.feeUnits)
    || !result.router.ptonMasterAddress
    || !Number.isInteger(result.router.majorVersion)
    || !Number.isInteger(result.router.minorVersion)) {
    throw new Error('STON.fi вернул некорректную котировку; транзакция не создана.');
  }
  return result;
}

export async function buildSwapTransaction({
  quote,
  fromToken,
  toToken,
  walletAddress,
  queryId
}) {
  if (!quote?.router || !walletAddress || !/^\d+$/.test(queryId)) {
    throw new Error('Недостаточно данных для подготовки транзакции.');
  }

  const contracts = dexFactory(quote.router);
  const client = getTonClient();
  const router = client.open(contracts.Router.create(quote.router.address));
  const proxyTon = contracts.pTON.create(quote.router.ptonMasterAddress);
  const sharedParams = {
    userWalletAddress: walletAddress,
    offerAmount: BigInt(quote.offerUnits),
    minAskAmount: BigInt(quote.minAskUnits),
    queryId: BigInt(queryId),
    deadline: Math.floor(Date.now() / 1000) + 300,
    refundAddress: walletAddress,
    excessesAddress: walletAddress,
    receiverAddress: walletAddress,
    askJettonWalletAddress: quote.askJettonWallet
  };

  if (fromToken.kind === 'Ton' && toToken.kind !== 'Ton') {
    return router.getSwapTonToJettonTxParams({
      ...sharedParams,
      proxyTon,
      offerJettonWalletAddress: quote.offerJettonWallet,
      askJettonAddress: toToken.address
    });
  }
  if (fromToken.kind !== 'Ton' && toToken.kind === 'Ton') {
    return router.getSwapJettonToTonTxParams({
      ...sharedParams,
      proxyTon,
      offerJettonAddress: fromToken.address
    });
  }
  if (fromToken.kind !== 'Ton' && toToken.kind !== 'Ton') {
    return router.getSwapJettonToJettonTxParams({
      ...sharedParams,
      offerJettonAddress: fromToken.address
    });
  }
  throw new Error('Нельзя обменять токен на самого себя.');
}

export async function lookupSwapStatus({ routerAddress, ownerAddress, queryId }) {
  return getStonApiClient().getSwapStatus({ routerAddress, ownerAddress, queryId });
}

export async function lookupLivePools(token0, token1) {
  return getStonApiClient().getPoolsByAssetPair({
    asset0Address: token0.apiAddress,
    asset1Address: token1.apiAddress
  });
}

export function createSwapQueryId() {
  const random = new Uint32Array(1);
  globalThis.crypto.getRandomValues(random);
  return (BigInt(Date.now()) * 65_536n + BigInt(random[0] & 0xffff)).toString();
}

export function getExternalMessageHash(boc) {
  if (typeof boc !== 'string' || !boc) return null;
  try {
    return Cell.fromBoc(Buffer.from(boc, 'base64'))[0]?.hash().toString('hex').toUpperCase() || null;
  } catch {
    return null;
  }
}
