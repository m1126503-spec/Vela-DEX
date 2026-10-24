# Perpetual market Tact scaffold

This is a **compiled architecture scaffold**, not an audited or deployable
derivatives protocol. The contracts pass Tact syntax/type checking and full
Tact/FunC code generation with `@tact-lang/compiler` 1.6.13. The frontend
repository contains no `MarginPool` source or ABI, Blueprint project, contract
tests, or deployment setup. The messages below are therefore an explicit
integration boundary, not a claim that they match an existing vault.

The compiler package used for validation emitted a deprecation notice. Pin and
verify a currently supported Tact compiler/toolchain before adopting this
scaffold in a contract project.

## Fixed-point model

- `PRICE_SCALE = 1_000_000_000`; oracle prices, base quantities, and quote
  collateral are normalized to 9 decimal places before they enter the market.
- All contract arithmetic uses Tact `Int`. There are no floating-point values.
- `notional = quantity * markPrice / PRICE_SCALE`.
- Long PnL is `(markPrice - entryPrice) * quantity / PRICE_SCALE`; short PnL
  reverses the price delta. PnL rounds against the trader: positive PnL rounds
  down and negative PnL rounds away from zero.
- `equity = collateral + unrealizedPnl - cumulativeFees - fundingPaid`.
  Positive `fundingPaid` is a payment; negative values are funding received.
- Notional and maintenance requirement round up, avoiding under-reserving due
  to integer truncation.
- Requested notional is checked before division:
  `quantity * markPrice <= collateral * leverage * PRICE_SCALE`.
- Liquidation is permitted only when `equity <= maintenanceRequirement`.
- Inputs are bounded to uint64 for collateral, quantity, and price so the
  intermediate products stay within Tact's signed 257-bit integer range.
- `leverage` is checked in `[1, 50]` and requested notional may not exceed
  `collateral * leverage`.

The 9-decimal collateral convention is an ABI choice for this scaffold, not the
native USDT precision. The vault must normalize token units exactly; never
convert collateral through floating point.

## Oracle flow and fail-closed behavior

1. `OracleAdapter` verifies Ed25519 over the canonical serialized
   `SignedPricePayload` (domain, feed, price, timestamp, sequence).
2. It rejects zero prices, future or stale timestamps, timestamp rollback,
   non-increasing sequence numbers, and price moves above the configured
   deviation bound.
3. It forwards accepted prices to the configured market. The market accepts
   updates only from that adapter and independently requires strictly
   increasing sequence numbers and non-decreasing timestamps.
4. Every open and liquidation also includes the signed quote. The market
   verifies its signature, domain, feed, timestamp, sequence, freshness, and
   maximum deviation itself in the same transaction that uses the price.
   This avoids trusting a cached price alone while the adapter's asynchronous
   update message is in flight.
5. A stale or out-of-range signed quote rejects both transitions. A stale feed
   can therefore delay liquidations; the protocol needs an independently
   designed pause/backstop policy before deployment.

TON contract messages are asynchronous, so the market cannot synchronously
read the adapter's newest state. Inline signature verification ensures that
an outlier quote itself cannot be used to open or liquidate, while the
adapter's circuit-breaker notification pauses the market after it arrives.
Until that notification arrives, an older still-fresh in-range signed quote
may remain usable. Set a suitably short staleness window and account for this
bounded propagation window in the final protocol design; eliminating it
entirely requires a single on-chain state transition to own both oracle
validation and market execution.

The off-chain signer must use the exact Tact cell layout for
`SignedPricePayload` / `SignedOraclePayload`. The market's domain ID and
public key and maximum-deviation setting must match the adapter's.
`domainId` must be unique to the chain/network, deployment, and feed. This
scaffold has a **single oracle signer**; key compromise, rotation, and
quorum/aggregation are not solved here.

## MarginPool integration boundary

`OpenPositionFromPool` is accepted only from the configured `marginPool`.
The pool must lock the owner's collateral before sending it and must release
the lock if the market call bounces. The market does not inspect an off-chain
balance or accept user claims about collateral. This scaffold permits only
one open position per owner; production position identity and ownership rules
must be aligned with the actual pool design.

On liquidation, the keeper can call `LiquidatePosition`. The market verifies
the oracle and liquidation threshold itself, marks the position pending, and
sends `SettleLiquidation` to the pool. The bounty is capped by all three of:

- positive equity after fees and funding;
- remaining position collateral;
- `maxLiquidatorBounty` and the configured bounty basis points.

The pool must atomically settle its locked collateral and only then send
`LiquidationSettled`. If settlement bounces, the market makes the position
retryable. The pool must validate its own escrow/accounting and must not pay
more than the supplied bounty; that behavior cannot be verified until its
actual implementation and ABI are available.

`accountingController` can submit monotonic cumulative fees and signed funding
totals. It is a trusted protocol component in this scaffold. Funding-rate
calculation, funding settlement, fee charging, partial close, collateral
withdrawal, insurance-fund accounting, and loss socialization are deliberately
not implemented.

## MarginPool (scaffold implementation)

`MarginPool.tact` provides a minimal native-TON collateral vault that matches
the integration boundary above:

- Users deposit TON (gas reserve reserved) and can withdraw free balance.
- `OpenPosition` locks the requested collateral, assigns a monotonic `positionId`,
  and forwards `OpenPositionFromPool` to the configured market with bounce enabled.
- On bounce of the open message the lock is released and collateral returned to free balance.
- `SettleLiquidation` (only from the market) caps the bounty, returns non-negative
  equity to the owner, marks the position liquidated, and sends `LiquidationSettled`.
- Getters expose free/locked balances and locked position records.

This is still a scaffold: amounts are raw TON (not 9-decimal normalized), there is
no insurance fund, partial close, funding settlement, or multi-position support,
and no formal verification. Use only for architecture exploration and sandbox testing.

## Before use

Create an isolated Tact/Blueprint project, pin a supported compiler version,
and implement an ABI-matched MarginPool. Add sandbox tests for
signature/domain mismatch, bad and stale timestamps, replayed sequence,
deviation rejection, arithmetic bounds, leverage and limit checks, stale-price
open/liquidation rejection, exact maintenance boundary, negative equity,
bounty caps, authorization, bounced messages, and settlement retries. Then
review generated code and run independent smart-contract security and economic
audits. Do not deploy this scaffold or enable trading on mainnet.
