# Vela DEX Telegram Mini App

Vela DEX routes TON mainnet swaps through the official STON.fi API and SDK. Quotes and router data come from STON.fi; the SDK builds the router transaction, and the connected wallet signs and submits it with TonConnect. Supported assets are a fixed allowlist of native TON, canonical Tether USD₮, and Notcoin. Token balances and wallet history are read from TonAPI. The Pools tab displays live STON.fi pool data; it does not submit liquidity transactions.

## Run locally

```sh
npm install
cp .env.example .env
npm run dev
```

Set `VITE_APP_URL` and `VITE_TONCONNECT_MANIFEST_URL` to the HTTPS deployment origin and manifest. Also update the `url` and `iconUrl` fields in `public/tonconnect-manifest.json` to the deployed origin before building. Configure the Mini App URL for `@vela_Officialapp_bot` with BotFather. Public RPC/API URLs can be changed with `VITE_TON_API_BASE_URL`, `VITE_STON_API_BASE_URL`, and `VITE_TON_RPC_URL`.

## Build and deploy

```sh
npm test
npm run build
```

Deploy to Vercel with build command `npm run build` and output directory `dist`. `vercel.json` configures SPA routing.

All `VITE_*` values are public and are embedded in the browser bundle. Never place bot tokens, wallet keys, RPC credentials, or other secrets in client environment variables. The default TON Center endpoint is public and may be rate-limited.

## Mainnet transaction safety

On-chain swaps are irreversible financial transactions. Bugs, malicious tokens, stale prices, wallet errors, and network conditions can cause losses. Test with very small amounts, verify the token, router, input, minimum output, attached TON amount, and wallet request before signing, and independently inspect confirmed transactions. The application requests a fresh STON.fi quote immediately before asking for a signature, shows the SDK-built transaction and minimum output, and rejects non-mainnet wallets. TonConnect acceptance means only that the wallet accepted the request; the UI separately polls TonAPI and STON.fi for the on-chain transaction and DEX result. If the API cannot confirm the operation, its status remains pending/unknown instead of being shown as successful.

The token picker is intentionally restricted to the canonical TON, USDT, and NOT assets. Pool details are read-only and sourced from STON.fi; LP operations are not implemented. The optional developer-wallet transfer is an ordinary, separate, explicitly confirmed transfer and is not a swap fee or atomic with a swap.
