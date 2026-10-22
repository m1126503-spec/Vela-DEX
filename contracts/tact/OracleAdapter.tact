const BASIS_POINTS: Int = 10_000;

struct SignedPricePayload {
    domainId: Int as uint256;
    feedId: Int as uint32;
    price: Int as uint64;
    timestamp: Int as uint64;
    sequence: Int as uint64;
}

struct OraclePrice {
    feedId: Int as uint32;
    price: Int as uint64;
    timestamp: Int as uint64;
    sequence: Int as uint64;
}

message SubmitSignedPrice {
    price: Int as uint64;
    timestamp: Int as uint64;
    sequence: Int as uint64;
    signature: Slice as bytes64;
}

message ResetOracleCircuitBreaker {
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

contract OracleAdapter {
    domainId: Int as uint256;
    feedId: Int as uint32;
    oraclePublicKey: Int as uint256;
    circuitBreakerAdmin: Address;
    market: Address;
    maxStalenessSeconds: Int as uint32;
    maxDeviationBps: Int as uint16;

    lastPrice: Int as uint64 = 0;
    lastTimestamp: Int as uint64 = 0;
    lastSequence: Int as uint64 = 0;
    circuitBroken: Bool = false;

    init(
        domainId: Int,
        feedId: Int,
        oraclePublicKey: Int,
        circuitBreakerAdmin: Address,
        market: Address,
        maxStalenessSeconds: Int,
        maxDeviationBps: Int
    ) {
        throwUnless(100, domainId > 0);
        throwUnless(101, oraclePublicKey > 0);
        throwUnless(102, maxStalenessSeconds > 0);
        throwUnless(103, maxDeviationBps <= BASIS_POINTS);

        self.domainId = domainId;
        self.feedId = feedId;
        self.oraclePublicKey = oraclePublicKey;
        self.circuitBreakerAdmin = circuitBreakerAdmin;
        self.market = market;
        self.maxStalenessSeconds = maxStalenessSeconds;
        self.maxDeviationBps = maxDeviationBps;
    }

    receive(msg: SubmitSignedPrice) {
        throwUnless(104, msg.price > 0);
        throwUnless(105, msg.timestamp <= now());
        throwUnless(106, now() - msg.timestamp <= self.maxStalenessSeconds);
        throwUnless(107, msg.timestamp >= self.lastTimestamp);
        throwUnless(108, msg.sequence > self.lastSequence);
        throwUnless(109, !self.circuitBroken);

        let payload = SignedPricePayload {
            domainId: self.domainId,
            feedId: self.feedId,
            price: msg.price,
            timestamp: msg.timestamp,
            sequence: msg.sequence,
        };
        throwUnless(
            110,
            checkSignature(payload.toCell().hash(), msg.signature, self.oraclePublicKey)
        );

        if (self.lastPrice > 0) {
            let delta = msg.price - self.lastPrice;
            if (delta < 0) {
                delta = -delta;
            }
            if (delta * BASIS_POINTS > self.lastPrice * self.maxDeviationBps) {
                self.lastTimestamp = msg.timestamp;
                self.lastSequence = msg.sequence;
                self.circuitBroken = true;
                send(SendParameters {
                    to: self.market,
                    value: 0,
                    mode: SendRemainingValue,
                    body: OraclePriceUpdated {
                        feedId: self.feedId,
                        price: self.lastPrice,
                        timestamp: msg.timestamp,
                        sequence: msg.sequence,
                        isValid: false,
                    }.toCell(),
                });
                return;
            }
        }

        self.lastPrice = msg.price;
        self.lastTimestamp = msg.timestamp;
        self.lastSequence = msg.sequence;

        send(SendParameters {
            to: self.market,
            value: 0,
            mode: SendRemainingValue,
            body: OraclePriceUpdated {
                feedId: self.feedId,
                price: msg.price,
                timestamp: msg.timestamp,
                sequence: msg.sequence,
                isValid: true,
            }.toCell(),
        });
    }

    receive(msg: ResetOracleCircuitBreaker) {
        throwUnless(111, sender() == self.circuitBreakerAdmin);
        throwUnless(112, self.circuitBroken);
        throwUnless(113, msg.price > 0);
        throwUnless(114, msg.timestamp <= now());
        throwUnless(115, now() - msg.timestamp <= self.maxStalenessSeconds);
        throwUnless(116, msg.timestamp >= self.lastTimestamp);
        throwUnless(117, msg.sequence > self.lastSequence);

        let payload = SignedPricePayload {
            domainId: self.domainId,
            feedId: self.feedId,
            price: msg.price,
            timestamp: msg.timestamp,
            sequence: msg.sequence,
        };
        throwUnless(
            118,
            checkSignature(payload.toCell().hash(), msg.signature, self.oraclePublicKey)
        );

        self.lastPrice = msg.price;
        self.lastTimestamp = msg.timestamp;
        self.lastSequence = msg.sequence;
        self.circuitBroken = false;

        send(SendParameters {
            to: self.market,
            value: 0,
            mode: SendRemainingValue,
            body: OraclePriceUpdated {
                feedId: self.feedId,
                price: msg.price,
                timestamp: msg.timestamp,
                sequence: msg.sequence,
                isValid: true,
            }.toCell(),
        });
    }

    get fun latestPrice(): OraclePrice {
        return OraclePrice {
            feedId: self.feedId,
            price: self.lastPrice,
            timestamp: self.lastTimestamp,
            sequence: self.lastSequence,
        };
    }
}
