const PRICE_SCALE: Int = 1_000_000_000;
const BASIS_POINTS: Int = 10_000;
const MAX_LEVERAGE: Int = 50;

struct Position {
    positionId: Int as uint64;
    owner: Address;
    collateral: Int as uint64;
    quantity: Int as uint64;
    entryPrice: Int as uint64;
    isLong: Bool;
    cumulativeFees: Int as uint64;
    fundingPaid: Int as int64;
    accountingSequence: Int as uint64;
    pendingLiquidation: Bool;
}

struct PositionRisk {
    markPrice: Int as uint64;
    notional: Int as uint128;
    unrealizedPnl: Int as int128;
    equity: Int as int128;
    maintenanceRequirement: Int as uint128;
    liquidatable: Bool;
}

struct SignedOraclePayload {
    domainId: Int as uint256;
    feedId: Int as uint32;
    price: Int as uint64;
    timestamp: Int as uint64;
    sequence: Int as uint64;
}

struct SignedOracleQuote {
    price: Int as uint64;
    timestamp: Int as uint64;
    sequence: Int as uint64;
    signature: Slice as bytes64;
}

message OraclePriceUpdated {
    feedId: Int as uint32;
    price: Int as uint64;
    timestamp: Int as uint64;
    sequence: Int as uint64;
    isValid: Bool;
}

message SetTradingEnabled {
    enabled: Bool;
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

message UpdatePositionCosts {
    positionId: Int as uint64;
    cumulativeFees: Int as uint64;
    fundingPaid: Int as int64;
    accountingSequence: Int as uint64;
}

message LiquidatePosition {
    positionId: Int as uint64;
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

contract PerpetualMarket {
    owner: Address;
    oracleAdapter: Address;
    marginPool: Address;
    accountingController: Address;
    oracleDomainId: Int as uint256;
    oraclePublicKey: Int as uint256;
    feedId: Int as uint32;
    maxStalenessSeconds: Int as uint32;
    maintenanceMarginBps: Int as uint16;
    maxOracleDeviationBps: Int as uint16;
    minNotional: Int as uint64;
    liquidationBountyBps: Int as uint16;
    maxLiquidatorBounty: Int as uint64;

    tradingEnabled: Bool = false;
    priceFaulted: Bool = true;
    markPrice: Int as uint64 = 0;
    priceTimestamp: Int as uint64 = 0;
    oracleSequence: Int as uint64 = 0;
    lastPositionId: Int as uint64 = 0;
    positions: map<Int as uint64, Position>;
    ownerPosition: map<Address, Int as uint64>;

    init(
        owner: Address,
        oracleAdapter: Address,
        marginPool: Address,
        accountingController: Address,
        oracleDomainId: Int,
        oraclePublicKey: Int,
        feedId: Int,
        maxStalenessSeconds: Int,
        maintenanceMarginBps: Int,
        maxOracleDeviationBps: Int,
        minNotional: Int,
        liquidationBountyBps: Int,
        maxLiquidatorBounty: Int
    ) {
        throwUnless(200, maxStalenessSeconds > 0);
        throwUnless(201, oracleDomainId > 0);
        throwUnless(202, oraclePublicKey > 0);
        throwUnless(203, maintenanceMarginBps > 0);
        throwUnless(204, maintenanceMarginBps < BASIS_POINTS);
        throwUnless(205, maxOracleDeviationBps <= BASIS_POINTS);
        throwUnless(206, minNotional > 0);
        throwUnless(207, liquidationBountyBps <= BASIS_POINTS);

        self.owner = owner;
        self.oracleAdapter = oracleAdapter;
        self.marginPool = marginPool;
        self.accountingController = accountingController;
        self.oracleDomainId = oracleDomainId;
        self.oraclePublicKey = oraclePublicKey;
        self.feedId = feedId;
        self.maxStalenessSeconds = maxStalenessSeconds;
        self.maintenanceMarginBps = maintenanceMarginBps;
        self.maxOracleDeviationBps = maxOracleDeviationBps;
        self.minNotional = minNotional;
        self.liquidationBountyBps = liquidationBountyBps;
        self.maxLiquidatorBounty = maxLiquidatorBounty;
    }

    fun freshMarkPrice(): Int {
        throwUnless(208, !self.priceFaulted);
        throwUnless(209, self.markPrice > 0);
        throwUnless(210, self.priceTimestamp <= now());
        throwUnless(211, now() - self.priceTimestamp <= self.maxStalenessSeconds);
        return self.markPrice;
    }

    fun acceptSignedQuote(quote: SignedOracleQuote): Int {
        throwUnless(212, !self.priceFaulted);
        throwUnless(213, quote.price > 0);
        throwUnless(214, quote.timestamp <= now());
        throwUnless(215, now() - quote.timestamp <= self.maxStalenessSeconds);
        throwUnless(216, quote.timestamp >= self.priceTimestamp);
        throwUnless(217, quote.sequence > self.oracleSequence);

        let payload = SignedOraclePayload {
            domainId: self.oracleDomainId,
            feedId: self.feedId,
            price: quote.price,
            timestamp: quote.timestamp,
            sequence: quote.sequence,
        };
        throwUnless(
            218,
            checkSignature(payload.toCell().hash(), quote.signature, self.oraclePublicKey)
        );

        if (self.markPrice > 0) {
            let delta = quote.price - self.markPrice;
            if (delta < 0) {
                delta = -delta;
            }
            throwUnless(
                219,
                delta * BASIS_POINTS <= self.markPrice * self.maxOracleDeviationBps
            );
        }

        self.markPrice = quote.price;
        self.priceTimestamp = quote.timestamp;
        self.oracleSequence = quote.sequence;
        return quote.price;
    }

    fun calculateRisk(position: Position, price: Int): PositionRisk {
        let priceDelta = price - position.entryPrice;
        if (!position.isLong) {
            priceDelta = -priceDelta;
        }

        let pnlNumerator = priceDelta * position.quantity;
        let unrealizedPnl = pnlNumerator / PRICE_SCALE;
        if (pnlNumerator < 0) {
            unrealizedPnl = -((-pnlNumerator + PRICE_SCALE - 1) / PRICE_SCALE);
        }

        let notional = (position.quantity * price + PRICE_SCALE - 1) / PRICE_SCALE;
        let equity = position.collateral + unrealizedPnl
            - position.cumulativeFees - position.fundingPaid;
        let maintenanceNumerator = notional * self.maintenanceMarginBps;
        let maintenanceRequirement = (maintenanceNumerator + BASIS_POINTS - 1) / BASIS_POINTS;

        return PositionRisk {
            markPrice: price,
            notional: notional,
            unrealizedPnl: unrealizedPnl,
            equity: equity,
            maintenanceRequirement: maintenanceRequirement,
            liquidatable: equity <= maintenanceRequirement,
        };
    }

    receive(msg: OraclePriceUpdated) {
        throwUnless(220, sender() == self.oracleAdapter);
        throwUnless(221, msg.feedId == self.feedId);
        throwUnless(222, msg.timestamp <= now());
        throwUnless(223, msg.timestamp >= self.priceTimestamp);
        throwUnless(224, msg.sequence > self.oracleSequence);

        self.priceTimestamp = msg.timestamp;
        self.oracleSequence = msg.sequence;
        if (msg.isValid) {
            throwUnless(225, msg.price > 0);
            if (now() - msg.timestamp <= self.maxStalenessSeconds) {
                self.markPrice = msg.price;
                self.priceFaulted = false;
            } else {
                self.priceFaulted = true;
            }
        } else {
            self.priceFaulted = true;
        }
    }

    receive(msg: SetTradingEnabled) {
        throwUnless(226, sender() == self.owner);
        self.tradingEnabled = msg.enabled;
    }

    receive(msg: OpenPositionFromPool) {
        throwUnless(227, sender() == self.marginPool);
        throwUnless(228, self.tradingEnabled);
        throwUnless(229, msg.positionId > self.lastPositionId);
        throwUnless(230, self.ownerPosition.get(msg.owner) == null);
        throwUnless(231, msg.collateral > 0);
        throwUnless(232, msg.quantity > 0);
        throwUnless(233, msg.leverage > 0 && msg.leverage <= MAX_LEVERAGE);
        throwUnless(234, msg.limitPrice > 0);

        let price = self.acceptSignedQuote(msg.oracleQuote);
        if (msg.isLong) {
            throwUnless(235, price <= msg.limitPrice);
        } else {
            throwUnless(236, price >= msg.limitPrice);
        }

        let notional = (msg.quantity * price + PRICE_SCALE - 1) / PRICE_SCALE;
        throwUnless(237, notional >= self.minNotional);
        throwUnless(
            238,
            msg.quantity * price <= msg.collateral * msg.leverage * PRICE_SCALE
        );

        let position = Position {
            positionId: msg.positionId,
            owner: msg.owner,
            collateral: msg.collateral,
            quantity: msg.quantity,
            entryPrice: price,
            isLong: msg.isLong,
            cumulativeFees: 0,
            fundingPaid: 0,
            accountingSequence: 0,
            pendingLiquidation: false,
        };

        self.positions.set(msg.positionId, position);
        self.ownerPosition.set(msg.owner, msg.positionId);
        self.lastPositionId = msg.positionId;
    }

    receive(msg: UpdatePositionCosts) {
        throwUnless(239, sender() == self.accountingController);

        let current: Position? = self.positions.get(msg.positionId);
        throwUnless(240, current != null);
        let position = current!!;
        throwUnless(241, !position.pendingLiquidation);
        throwUnless(242, msg.accountingSequence > position.accountingSequence);
        throwUnless(243, msg.cumulativeFees >= position.cumulativeFees);

        let updated = Position {
            positionId: position.positionId,
            owner: position.owner,
            collateral: position.collateral,
            quantity: position.quantity,
            entryPrice: position.entryPrice,
            isLong: position.isLong,
            cumulativeFees: msg.cumulativeFees,
            fundingPaid: msg.fundingPaid,
            accountingSequence: msg.accountingSequence,
            pendingLiquidation: position.pendingLiquidation,
        };
        self.positions.set(msg.positionId, updated);
    }

    receive(msg: LiquidatePosition) {
        let current: Position? = self.positions.get(msg.positionId);
        throwUnless(244, current != null);
        let position = current!!;
        throwUnless(245, !position.pendingLiquidation);

        let price = self.acceptSignedQuote(msg.oracleQuote);
        let risk = self.calculateRisk(position, price);
        throwUnless(246, risk.liquidatable);

        let recoverable = risk.equity;
        if (recoverable < 0) {
            recoverable = 0;
        }
        if (recoverable > position.collateral) {
            recoverable = position.collateral;
        }

        let bounty = recoverable * self.liquidationBountyBps / BASIS_POINTS;
        if (bounty > self.maxLiquidatorBounty) {
            bounty = self.maxLiquidatorBounty;
        }

        let pending = Position {
            positionId: position.positionId,
            owner: position.owner,
            collateral: position.collateral,
            quantity: position.quantity,
            entryPrice: position.entryPrice,
            isLong: position.isLong,
            cumulativeFees: position.cumulativeFees,
            fundingPaid: position.fundingPaid,
            accountingSequence: position.accountingSequence,
            pendingLiquidation: true,
        };
        self.positions.set(msg.positionId, pending);

        send(SendParameters {
            to: self.marginPool,
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            body: SettleLiquidation {
                positionId: msg.positionId,
                owner: position.owner,
                liquidator: sender(),
                bounty: bounty,
                equity: risk.equity,
                markPrice: price,
                oracleSequence: self.oracleSequence,
            }.toCell(),
        });
    }

    receive(msg: LiquidationSettled) {
        throwUnless(247, sender() == self.marginPool);
        let current: Position? = self.positions.get(msg.positionId);
        throwUnless(248, current != null);
        let position = current!!;
        throwUnless(249, position.pendingLiquidation);

        self.positions.del(msg.positionId);
        self.ownerPosition.del(position.owner);
    }

    bounced(msg: bounced<SettleLiquidation>) {
        let current: Position? = self.positions.get(msg.positionId);
        if (current != null) {
            let position = current!!;
            if (position.pendingLiquidation) {
                let retryable = Position {
                    positionId: position.positionId,
                    owner: position.owner,
                    collateral: position.collateral,
                    quantity: position.quantity,
                    entryPrice: position.entryPrice,
                    isLong: position.isLong,
                    cumulativeFees: position.cumulativeFees,
                    fundingPaid: position.fundingPaid,
                    accountingSequence: position.accountingSequence,
                    pendingLiquidation: false,
                };
                self.positions.set(msg.positionId, retryable);
            }
        }
    }

    get fun positionRisk(positionId: Int): PositionRisk {
        let current: Position? = self.positions.get(positionId);
        throwUnless(250, current != null);
        let position = current!!;
        return self.calculateRisk(position, self.freshMarkPrice());
    }
}
