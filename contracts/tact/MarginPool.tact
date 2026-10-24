const PRICE_SCALE: Int = 1_000_000_000;
const MIN_DEPOSIT: Int = ton("0.1");
const GAS_RESERVE: Int = ton("0.05");

message Deposit {}

message Withdraw {
    amount: Int as coins;
}

message OpenPosition {
    quantity: Int as uint64;
    leverage: Int as uint8;
    isLong: Bool;
    limitPrice: Int as uint64;
    collateral: Int as uint64;
    oracleQuote: SignedOracleQuote;
}

message OpenPositionFromPool {
    positionId: Int as uint64;
    owner: Address;
    collateral: Int as uint64;
    quantity: Int as uint64;
    leverage: Int as uint8;
    isLong: Bool;
    limitPrice: Int as uint64;
    oracleQuote: SignedOracleQuote;
}

message SettleLiquidation {
    positionId: Int as uint64;
    owner: Address;
    liquidator: Address;
    bounty: Int as uint64;
    equity: Int as int128;
    markPrice: Int as uint64;
    oracleSequence: Int as uint64;
}

message LiquidationSettled {
    positionId: Int as uint64;
}

struct LockedPosition {
    owner: Address;
    collateral: Int as uint64;
    liquidated: Bool;
}

contract MarginPool {
    owner: Address;
    market: Address;
    balances: map<Address, Int>;
    locked: map<Address, Int>;
    positions: map<Int as uint64, LockedPosition>;
    lastPositionId: Int as uint64 = 0;
    pendingOpen: map<Int as uint64, Address>;

    init(owner: Address, market: Address) {
        self.owner = owner;
        self.market = market;
    }

    // --- User balance management ---

    receive(msg: Deposit) {
        let ctx: Context = context();
        let depositAmount = ctx.value - GAS_RESERVE;
        throwUnless(100, depositAmount >= MIN_DEPOSIT);

        let current = self.balances.get(ctx.sender) ?? 0;
        self.balances.set(ctx.sender, current + depositAmount);
    }

    receive(msg: Withdraw) {
        let ctx: Context = context();
        let free = self.balances.get(ctx.sender) ?? 0;
        throwUnless(101, free >= msg.amount);
        throwUnless(102, msg.amount > 0);

        self.balances.set(ctx.sender, free - msg.amount);

        send(SendParameters {
            to: ctx.sender,
            value: msg.amount,
            mode: SendPayGasSeparately,
            body: "Withdrawal successful".asComment(),
        });
    }

    // --- Open position (lock then forward to market) ---

    receive(msg: OpenPosition) {
        let ctx: Context = context();
        let free = self.balances.get(ctx.sender) ?? 0;
        throwUnless(103, free >= msg.collateral);
        throwUnless(104, msg.collateral > 0);
        throwUnless(105, msg.quantity > 0);
        throwUnless(106, msg.leverage > 0 && msg.leverage <= 50);

        // Lock collateral
        self.balances.set(ctx.sender, free - msg.collateral);
        let lockedNow = self.locked.get(ctx.sender) ?? 0;
        self.locked.set(ctx.sender, lockedNow + msg.collateral);

        // Assign position id
        self.lastPositionId = self.lastPositionId + 1;
        let positionId = self.lastPositionId;

        let lockedPos = LockedPosition {
            owner: ctx.sender,
            collateral: msg.collateral,
            liquidated: false,
        };
        self.positions.set(positionId, lockedPos);
        self.pendingOpen.set(positionId, ctx.sender);

        // Forward to market (bounce: true so we can unlock on failure)
        send(SendParameters {
            to: self.market,
            value: ton("0.1"),
            bounce: true,
            mode: SendPayGasSeparately,
            body: OpenPositionFromPool {
                positionId: positionId,
                owner: ctx.sender,
                collateral: msg.collateral,
                quantity: msg.quantity,
                leverage: msg.leverage,
                isLong: msg.isLong,
                limitPrice: msg.limitPrice,
                oracleQuote: msg.oracleQuote,
            }.toCell(),
        });
    }

    // Unlock on bounce from market open
    bounced(msg: bounced<OpenPositionFromPool>) {
        let positionId = msg.positionId;
        let owner = self.pendingOpen.get(positionId);
        if (owner != null) {
            let pos = self.positions.get(positionId);
            if (pos != null && !pos!!.liquidated) {
                // Unlock
                let lockedNow = self.locked.get(owner!!) ?? 0;
                if (lockedNow >= pos!!.collateral) {
                    self.locked.set(owner!!, lockedNow - pos!!.collateral);
                }
                let free = self.balances.get(owner!!) ?? 0;
                self.balances.set(owner!!, free + pos!!.collateral);

                self.positions.del(positionId);
                self.pendingOpen.del(positionId);
            }
        }
    }

    // --- Liquidation settlement (only from market) ---

    receive(msg: SettleLiquidation) {
        throwUnless(107, sender() == self.market);

        let pos = self.positions.get(msg.positionId);
        throwUnless(108, pos != null);
        let lockedPos = pos!!;
        throwUnless(109, lockedPos.owner == msg.owner);
        throwUnless(110, !lockedPos.liquidated);

        // Cap bounty to locked collateral
        let bounty = msg.bounty;
        if (bounty > lockedPos.collateral) {
            bounty = lockedPos.collateral;
        }
        if (bounty < 0) {
            bounty = 0;
        }

        // Remaining equity returned to owner (non-negative)
        let equityReturn = msg.equity;
        if (equityReturn < 0) {
            equityReturn = 0;
        }
        if (equityReturn > lockedPos.collateral - bounty) {
            equityReturn = lockedPos.collateral - bounty;
        }

        // Unlock and adjust balances
        let lockedNow = self.locked.get(msg.owner) ?? 0;
        if (lockedNow >= lockedPos.collateral) {
            self.locked.set(msg.owner, lockedNow - lockedPos.collateral);
        }

        // Pay liquidator
        if (bounty > 0) {
            send(SendParameters {
                to: msg.liquidator,
                value: bounty,
                mode: SendPayGasSeparately,
            });
        }

        // Return remaining to owner
        if (equityReturn > 0) {
            let free = self.balances.get(msg.owner) ?? 0;
            self.balances.set(msg.owner, free + equityReturn);
        }

        // Mark liquidated and confirm to market
        let settled = LockedPosition {
            owner: lockedPos.owner,
            collateral: lockedPos.collateral,
            liquidated: true,
        };
        self.positions.set(msg.positionId, settled);

        send(SendParameters {
            to: self.market,
            value: ton("0.05"),
            bounce: true,
            mode: SendPayGasSeparately,
            body: LiquidationSettled {
                positionId: msg.positionId,
            }.toCell(),
        });
    }

    // If confirmation to market bounces, keep position marked so it can be retried
    bounced(msg: bounced<LiquidationSettled>) {
        // Position stays marked liquidated; market will retry via its own bounce handler
        // No automatic unlock here — settlement already adjusted balances
    }

    // --- Getters ---

    get fun get_free_balance(user: Address): Int {
        return self.balances.get(user) ?? 0;
    }

    get fun get_locked_balance(user: Address): Int {
        return self.locked.get(user) ?? 0;
    }

    get fun get_position(positionId: Int): LockedPosition? {
        return self.positions.get(positionId);
    }
}
