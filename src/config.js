export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Vela DEX';
export const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '@vela_Officialapp_bot';
export const APP_URL = import.meta.env.VITE_APP_URL || '';
export const TON_API_BASE_URL = import.meta.env.VITE_TON_API_BASE_URL || 'https://tonapi.io';
export const TONCONNECT_MANIFEST_URL = import.meta.env.VITE_TONCONNECT_MANIFEST_URL
  || `${APP_URL.replace(/\/+$/, '')}/tonconnect-manifest.json`;
export const PLATFORM_WALLET_ADDRESS = import.meta.env.VITE_PLATFORM_WALLET_ADDRESS
  || 'UQB4fs8v2DvxxDr_bjWZRWOTdcYXoZ8Vr72kkWcVTmyC8xGT';
