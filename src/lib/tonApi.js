import { TON_API_BASE_URL } from '../config';

const API_BASE = TON_API_BASE_URL.replace(/\/+$/, '');

async function request(path, signal) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal
  });
  if (!response.ok) {
    throw new Error(`TonAPI: ${response.status} ${response.statusText || 'request failed'}`);
  }
  return response.json();
}

function accountPath(address) {
  return `/v2/accounts/${encodeURIComponent(address)}`;
}

export function fetchWalletTonBalance(address, signal) {
  return request(accountPath(address), signal);
}

export async function fetchWalletJettons(address, signal) {
  const data = await request(`${accountPath(address)}/jettons`, signal);
  return Array.isArray(data?.balances) ? data.balances : [];
}

export function fetchWalletEvents(address, signal) {
  return request(`${accountPath(address)}/events?limit=10`, signal);
}

export async function fetchTransactionByMessageHash(messageHash) {
  const response = await fetch(`${API_BASE}/v2/blockchain/messages/${encodeURIComponent(messageHash)}/transaction`, {
    headers: { Accept: 'application/json' }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`TonAPI transaction lookup failed: ${response.status} ${response.statusText || 'request failed'}`);
  }
  return response.json();
}
