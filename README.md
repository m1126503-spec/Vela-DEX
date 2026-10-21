# Vela DEX Telegram Mini App

Vela DEX is a client-only demo of a TON-themed exchange UI. It simulates constant-product AMM swaps (`x * y = k`), a 0.30% pool fee, and liquidity positions in browser-local data. It does not include a router contract or execute swaps/liquidity operations on-chain.

## Run locally

```sh
npm install
cp .env.example .env
npm run dev
```

Set `VITE_APP_URL` and `VITE_TONCONNECT_MANIFEST_URL` to the HTTPS origin and manifest URL of your deployment before publishing. The TonConnect manifest at `public/tonconnect-manifest.json` must use that public origin and an HTTPS icon URL. `VITE_TELEGRAM_BOT_USERNAME` identifies the existing bot; configure the deployed HTTPS URL as its Mini App URL with BotFather.

## Build and deploy to Vercel

```sh
npm test
npm run build
```

Import this folder as a Vite project in Vercel, keep the default build command `npm run build` and output directory `dist`, and add the public `VITE_*` settings from `.env.example` in Project Settings. `vercel.json` serves the SPA entry point for client routes.

All `VITE_*` values are exposed to the browser. Do not put bot tokens, private keys, or other secrets in them. TonAPI is queried directly from the client; a provider key is intentionally not included.

## Demo and wallet safety

Swap quotes and Pool changes only update local demo state and demo history; they never call TonConnect. Connected wallet address, TON balance, jettons, and recent events are fetched separately from TonAPI and are not replaced with demo values when a request fails.

The optional developer-wallet feature sends one ordinary, user-approved TonConnect transfer to `VITE_PLATFORM_WALLET_ADDRESS`. It is a separate voluntary transfer, not a swap fee, is not atomic with a successful swap, and is not refundable if a simulation is canceled or fails. The amount and recipient are displayed for a second confirmation before the wallet is opened.
