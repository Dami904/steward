// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Per-agent conduct record. spec/tiers.md section 6. Only factory-created
/// StewardAccounts may report into it (invariant O-16).
///
/// onchain-access-control skill, check 3 (recompute, don't trust the claim): `report()`
/// does NOT take a caller-supplied "I was made by factory X" parameter — that would let any
/// contract forge provenance by naming a registered factory. Instead, a registered factory
/// calls `recordAccountCreated` at creation time, and `report()` checks
/// `isFactoryCreatedAccount[msg.sender]` — a fact this contract itself recorded, not a claim
/// the caller makes about itself.
contract ConductRegistry {
    struct Record {
        uint32 accountsCount;
        uint32 distinctOwnersCount;
        uint128 totalRiskUnits;
        uint32 incidentCount;
        uint8 maxTierReached;
        uint40 firstSeen;
        uint40 cleanStreakStart;
    }

    address public immutable admin;
    mapping(address => bool) public isRegisteredFactory;
    // Set only by recordAccountCreated, called by a currently-registered factory. Keyed by
    // account address (the StewardAccount instance), since that's who calls report() later.
    mapping(address => bool) public isFactoryCreatedAccount;
    mapping(address => Record) private records;
    // Per (agent, owner) seen-before flag, so distinctOwnersCount only increments once per
    // real distinct owner rather than once per report.
    mapping(address => mapping(address => bool)) private seenOwner;

    event FactoryRegistered(address indexed factory);
    event FactoryRevoked(address indexed factory);
    event AccountCreated(address indexed agent, address indexed account, address indexed factory);
    event Reported(
        address indexed agent, address indexed account, address owner, uint8 tier, uint128 riskUnitsDelta, bool incident
    );

    error NotAdmin();
    error NotRegisteredFactory();
    error NotFactoryCreatedAccount();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        require(admin_ != address(0), "ConductRegistry: zero admin");
        admin = admin_;
    }

    function registerFactory(address factory) external onlyAdmin {
        // forge-lint: disable-next-line(missing-events-access-control) -- FactoryRegistered is emitted below
        isRegisteredFactory[factory] = true;
        emit FactoryRegistered(factory);
    }

    function revokeFactory(address factory) external onlyAdmin {
        // forge-lint: disable-next-line(missing-events-access-control) -- FactoryRevoked is emitted below
        isRegisteredFactory[factory] = false;
        emit FactoryRevoked(factory);
    }

    /// @dev Called once by the factory (must be currently registered) at account creation
    /// time. `account` is the newly-deployed StewardAccount address; this is what makes its
    /// later `report()` calls trustworthy, since we're recording the fact ourselves rather
    /// than accepting the account's own word for it.
    function recordAccountCreated(address agent, address account) external {
        if (!isRegisteredFactory[msg.sender]) revert NotRegisteredFactory();
        // forge-lint: disable-next-line(missing-events-access-control) -- AccountCreated is emitted below
        isFactoryCreatedAccount[account] = true;
        records[agent].accountsCount += 1;
        emit AccountCreated(agent, account, msg.sender);
    }

    /// @dev Called by a StewardAccount (msg.sender) on graduation, demotion, and periodic
    /// checkpoints.
    function report(address agent, address owner, uint8 tier, uint128 riskUnitsDelta, bool incident) external {
        if (!isFactoryCreatedAccount[msg.sender]) revert NotFactoryCreatedAccount();

        Record storage r = records[agent];
        if (r.firstSeen == 0) {
            // forge-lint: disable-next-line(unsafe-typecast)
            r.firstSeen = uint40(block.timestamp); // safe until year 36812
            // forge-lint: disable-next-line(unsafe-typecast)
            r.cleanStreakStart = uint40(block.timestamp); // safe until year 36812
        }
        if (!seenOwner[agent][owner]) {
            seenOwner[agent][owner] = true;
            r.distinctOwnersCount += 1;
        }
        r.totalRiskUnits += riskUnitsDelta;
        if (tier > r.maxTierReached) r.maxTierReached = tier;
        if (incident) {
            r.incidentCount += 1;
            // forge-lint: disable-next-line(unsafe-typecast)
            r.cleanStreakStart = uint40(block.timestamp); // safe until year 36812
        }

        emit Reported(agent, msg.sender, owner, tier, riskUnitsDelta, incident);
    }

    function recordOf(address agent) external view returns (Record memory) {
        return records[agent];
    }
}
