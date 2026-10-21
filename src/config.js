const env = import.meta.env || {};

export const APP_NAME = env.VITE_APP_NAME || 'Vela DEX';
export const TELEGRAM_BOT_USERNAME = env.VITE_TELEGRAM_BOT_USERNAME || '@vela_Officialapp_bot';
export const APP_URL = env.VITE_APP_URL || '';
export const TON_API_BASE_URL = env.VITE_TON_API_BASE_URL || 'https://tonapi.io';
export const STON_API_BASE_URL = env.VITE_STON_API_BASE_URL || 'https://api.ston.fi';
export const TON_RPC_URL = env.VITE_TON_RPC_URL || 'https://toncenter.com/api/v2/jsonRPC';
export const TONCONNECT_MANIFEST_URL = env.VITE_TONCONNECT_MANIFEST_URL
  || `${APP_URL.replace(/\/+$/, '')}/tonconnect-manifest.json`;
export const PLATFORM_WALLET_ADDRESS = env.VITE_PLATFORM_WALLET_ADDRESS
  || 'UQB4fs8v2DvxxDr_bjWZRWOTdcYXoZ8Vr72kkWcVTmyC8xGT';
