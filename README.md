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

The Futures tab has a separate Hyperliquid testnet workspace and the prior Storm Trade V3 read-only/calculator view. Hyperliquid always uses the SDK's testnet transport and the Arbitrum Sepolia EIP-712 signature domain; there is no mainnet order route. Trading is limited to manually reviewed GTC limit orders with a $250 maximum displayed notional, plus cancel requests for the connected account's individually selected open orders. Market orders, leverage changes, transfers, withdrawals, and TON-wallet signing are not implemented.

The Analytics tab is a separate read-only Hyperliquid mainnet protocol dashboard. TVL, fees, and DEX volume history/aggregates come from DeFiLlama; live perpetual open interest and HYPE mark price/24-hour change are calculated from public Hyperliquid market contexts. Source failures are shown per dashboard refresh, and unavailable values are not replaced with mock data. This analytics view does not connect a wallet or submit transactions.

Connect an injected EVM wallet on Arbitrum Sepolia. The wallet signs each action directly; the app never reads or stores its private key. Market metadata, order book, account state, positions, and open orders are read from Hyperliquid's testnet API. The community-supported `@nktkas/hyperliquid` SDK formats price and size using the market's `szDecimals`; the app stores the client order ID and non-secret order metadata in local storage before requesting a signature. If submission times out or its outcome is unclear, do not retry: use “Проверить ID” and the venue's order history first. `resting` means accepted and open, not filled; only a venue-reported fill or position change is execution evidence. API access does not prove a live, funded testnet account is available. Obtain any test funds only through Hyperliquid's official testnet onboarding/faucet, whose eligibility requirements may change; this app never transfers or bridges funds.

To enable Storm reads, set `VITE_STORM_V3_NETWORK=testnet`, `VITE_STORM_V3_API_URL`, and `VITE_STORM_V3_MARKETS_URL` to the public testnet endpoints provided through Storm builder onboarding. Mainnet URLs are rejected, redirects are disabled, and saved intent hashes are kept locally before status checks. Do not treat `accepted`/`done` as a fill; verify bundles, transactions, and position state.

Storm order submission remains intentionally disabled. Storm V3 requires a funded testnet Smart Account and a registered Ed25519 signing key; TonConnect wallet signatures and `ton_proof` cannot sign intents. This app does not create or store signing keys. The Storm calculator still uses a user-entered reference price and does not provide a Storm quote, verified Smart Account collateral, minimum-order rules, fee estimates, or execution. Its position and adverse-move figures are simplified and omit venue-specific margin, funding, slippage, and liquidation rules.

### Vault Transit signer adapter (backend only)

`server/stormVaultSigner.js` is a server-side adapter for a Vault Transit Ed25519 key. It reads the configured public key version, pins signatures to that version, sends the exact 32-byte Storm hash as base64 with `prehashed: false`, requires a 64-byte Vault signature, and verifies it locally as a pure Ed25519 signature before returning it. The helper is not imported by the browser and does not expose a public signing endpoint. The order flow remains disabled: do not expose this helper to arbitrary client-supplied hashes or wire it to order submission until authentication, request validation, durable query-ID/hash storage, Storm testnet onboarding and end-to-end checks are in place.

Create a non-exportable test key in Vault and grant the application token only `read` on that key and `update` on its `transit/sign` path. Never use a root token:

```sh
vault write -f transit/keys/vela-storm-signer type=ed25519 exportable=false allow_plaintext_backup=false deletion_allowed=false
```

Set `VAULT_ADDR`, `VAULT_TOKEN`, and `VAULT_TRANSIT_KEY=vela-storm-signer` only in the backend/service environment; optionally set `VAULT_TRANSIT_MOUNT` when Transit is mounted somewhere other than `transit`. Run `npm run storm:vault-check` to sign a fixed compatibility-test hash and verify it against Vault's public key. Before any order signer is wired, register the printed public key with Storm and set `VAULT_TRANSIT_KEY_VERSION` to the printed version so automatic Vault key rotation cannot silently switch the signer. Keep the Vault token out of all `VITE_*` variables and browser storage. The compatibility check was not run against a real Vault instance here; it must pass with the actual test Vault key before enabling orders. Use a Storm-provided testnet endpoint and Smart Account only; no mainnet order route is implemented.
