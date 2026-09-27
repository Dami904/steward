// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StewardAccount} from "./StewardAccount.sol";
import {ConductRegistry} from "./ConductRegistry.sol";
import {Types} from "./libraries/Types.sol";

/// @notice spec/tiers.md section 6: creates accounts and sets their start tier from the
/// agent's conduct record. A stranger starts at T0.
contract StewardFactory {
    address public immutable usdc;
    address public immutable adapter;
    address public immutable healthFeed;
    ConductRegistry public immutable conductRegistry;

    event AccountCreated(address indexed account, address indexed owner, address indexed agent, uint8 startTier);

    constructor(address usdc_, address adapter_, address healthFeed_, address conductRegistry_) {
        require(
            usdc_ != address(0) && adapter_ != address(0) && healthFeed_ != address(0) && conductRegistry_ != address(0),
            "StewardFactory: zero address"
        );
        usdc = usdc_;
        adapter = adapter_;
        healthFeed = healthFeed_;
        conductRegistry = ConductRegistry(conductRegistry_);
    }

    /// @dev Numeric thresholds here are a documented judgment call, not specified exactly
    /// by the plan beyond "a record with enough distinct owners and
    /// clean risk units starts higher." T3 is deliberately unreachable at creation — it can
    /// only be earned live via graduate(), never granted for free.
    function tierFor(ConductRegistry.Record memory record) public pure returns (uint8) {
        if (record.incidentCount > 0) return 0;
        Types.TierLimits memory t1 = Types.tierLimits(1);
        Types.TierLimits memory t2 = Types.tierLimits(2);
        if (record.distinctOwnersCount >= 3 && record.totalRiskUnits >= t2.minRiskUnits) {
            return 2;
        }
        if (record.distinctOwnersCount >= 2 && record.totalRiskUnits >= t1.minRiskUnits) {
            return 1;
        }
        return 0;
    }

    function createAccount(
        address owner,
        address agent,
        address guardian,
        uint128 hardCap,
        Types.Mandate calldata mandate,
        Types.Envelope calldata envelope,
        uint8 maxStartTier
    ) external returns (address account) {
        ConductRegistry.Record memory record = conductRegistry.recordOf(agent);
        uint8 startTier = tierFor(record);
        if (startTier > maxStartTier) startTier = maxStartTier;

        account = address(
            new StewardAccount(
                owner, agent, guardian, usdc, adapter, healthFeed, address(conductRegistry), hardCap, mandate, envelope, startTier
            )
        );

        conductRegistry.recordAccountCreated(agent, account);

        emit AccountCreated(account, owner, agent, startTier);
    }
}
