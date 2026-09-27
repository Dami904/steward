// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {StewardAccount} from "../src/StewardAccount.sol";
import {StewardFactory} from "../src/StewardFactory.sol";
import {ConductRegistry} from "../src/ConductRegistry.sol";
import {VaultHealthFeed} from "../src/VaultHealthFeed.sol";
import {ManagedVaultAdapter} from "../src/adapters/ManagedVaultAdapter.sol";
import {Types} from "../src/libraries/Types.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockManagedVault} from "../test/mocks/MockManagedVault.sol";

/// @notice NOT part of the Phase 4 demo (that's DeployDemo.s.sol, forked against the real BSC
/// vault). This is a throwaway local-only deployment against a plain, non-forked Anvil (no
/// BSC RPC, no archive-access flakiness) using this repo's own test mocks (test/mocks/), for
/// exercising apps/web/app/app (the live wallet-connected app) end to end without depending
/// on a public RPC's archive-pruning behavior. Never referenced by any `make` target or CI —
/// a manual dev tool only. Same well-known Anvil dev keys as DeployDemo.s.sol, same role
/// assignment (deployer=0, owner=1, agent=2, guardian=3).
///
/// Usage: forge script script/DeployLocalMock.s.sol --rpc-url http://127.0.0.1:8551 --broadcast
contract DeployLocalMock is Script {
    uint256 constant DEPLOYER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant OWNER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant AGENT = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address constant GUARDIAN = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

    function run() external {
        vm.startBroadcast(DEPLOYER_PK);
        address deployer = vm.addr(DEPLOYER_PK);

        MockERC20 usdc = new MockERC20("USD Coin", "USDC");
        MockManagedVault vault = new MockManagedVault(address(usdc));
        ManagedVaultAdapter adapter = new ManagedVaultAdapter(address(vault));
        ConductRegistry registry = new ConductRegistry(deployer);
        VaultHealthFeed healthFeed = new VaultHealthFeed(deployer);
        StewardFactory factory =
            new StewardFactory(address(usdc), address(adapter), address(healthFeed), address(registry));

        registry.registerFactory(address(factory));
        healthFeed.registerReporter(deployer);
        healthFeed.publish(
            address(vault),
            VaultHealthFeed.HealthSnapshot({
                fromBlock: uint64(block.number),
                toBlock: uint64(block.number),
                ts: uint40(block.timestamp),
                method: Types.METHOD_REQUEST_FINALIZE_VIEW,
                n: 6,
                p50Sec: 3600,
                p90Sec: 7200,
                maxSec: 86400,
                navPerShare: 1e18,
                drawdownBps: 0,
                codehash: bytes32(0),
                flags: 0,
                evidenceHash: bytes32(0)
            })
        );

        Types.Mandate memory mandate = Types.Mandate({
            maxTxUsdc: 1000e18,
            maxBps: 10000,
            maxVaultUsdc: 1200e18,
            minLiquidUsdc: 0,
            maxActionsPerDay: 100,
            expiry: uint40(block.timestamp + 365 days),
            loosenDelay: 1 days,
            issuerHaircutBps: 0,
            latencyHaircutBpsPerDay: 0,
            latencyHaircutMaxBps: 0,
            leadFloorDays: 2,
            approvalAbove: 500e18
        });
        // capacityCap generous (an earlier demo's lesson: the mandate/
        // envelope ceiling must not be the binding constraint, or tier effects are invisible).
        Types.Envelope memory envelope =
            Types.Envelope({capacityCap: 1200e18, capCeiling: 1200e18, reserveUsdc: 0, paused: false});

        address acct = factory.createAccount(OWNER, AGENT, GUARDIAN, 1200e18, mandate, envelope, 0);

        usdc.mint(acct, 10000e18);

        vm.stopBroadcast();

        console2.log("usdc:", address(usdc));
        console2.log("vault:", address(vault));
        console2.log("adapter:", address(adapter));
        console2.log("registry:", address(registry));
        console2.log("healthFeed:", address(healthFeed));
        console2.log("factory:", address(factory));
        console2.log("account:", acct);
    }
}
