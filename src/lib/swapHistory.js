import { normalizeAddress } from './stonSwap.js';

const SWAP_STATUSES = new Set(['pending', 'success', 'failed', 'unknown']);

function validHash(value) {
  return typeof value === 'string' && /^[A-Fa-f0-9]{64}$/.test(value) ? value : '';
}

export function normalizeSwapHistory(saved) {
  if (!Array.isArray(saved)) return [];
  return saved.filter((item) => item
    && typeof item.id === 'string'
    && typeof item.queryId === 'string'
    && /^\d+$/.test(item.queryId)
    && normalizeAddress(item.routerAddress)
    && normalizeAddress(item.ownerAddress)
    && Number.isFinite(item.createdAt)
    && typeof item.fromSymbol === 'string'
    && typeof item.toSymbol === 'string'
    && typeof item.fromAmount === 'string'
    && typeof item.expectedAmount === 'string'
    && typeof item.minimumAmount === 'string'
    && (!item.messageHash || /^[A-Fa-f0-9]{64}$/.test(item.messageHash)))
    .slice(0, 20)
    .map((item) => ({
      ...item,
      status: SWAP_STATUSES.has(item.status) ? item.status : 'pending',
      txHash: validHash(item.txHash),
      walletTxHash: validHash(item.walletTxHash),
      exitCode: typeof item.exitCode === 'string' ? item.exitCode : '',
      error: typeof item.error === 'string' ? item.error : '',
      statusCheckError: ''
    }));
}
