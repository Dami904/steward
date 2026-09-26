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

/// @notice Phase 4 demo deployment (spec/DECISIONS.md's "Live deployment -> fork-only"
/// decision). Deploys the full stack onto whatever RPC this script is pointed at — for this
/// project that is ALWAYS the persistent local Anvil fork from scripts/fork-node.sh, never
/// real BSC. `--broadcast` here means "send these transactions to the target RPC," and the
/// target RPC is a local fork; nothing here ever reaches live BSC or spends real funds.
///
/// Deploys the shared infrastructure (adapter, registry, health feed, factory) and Agent A's
/// StewardAccount at T0. Agent B (the "stranger" contrast case) is deliberately NOT created
/// here — scripts/demo-driver.ts creates it fresh, later, after Agent A has already earned a
/// graduation history, so the demo narrative ("same request, two agents") has something to
/// contrast against.
///
/// Roles use Anvil's well-known, publicly-documented deterministic dev accounts (same ones
/// every `anvil`/`hardhat node` prints on startup) — safe to hardcode since they only ever
/// hold fake ETH/tokens on a local fork. Never use these on any real network.
///
/// Usage: forge script script/DeployDemo.s.sol --rpc-url http://127.0.0.1:8546 --broadcast
contract DeployDemo is Script {
    address constant REAL_VAULT = 0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82;
    address constant REAL_USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;

    // Anvil dev account 0 — deployer/admin/health-reporter for this demo.
    uint256 constant DEPLOYER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    // Anvil dev accounts 1/2/3 — Agent A's owner/agent/guardian.
    address constant OWNER_A = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant AGENT_A = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address constant GUARDIAN_A = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

    function run() external {
        vm.startBroadcast(DEPLOYER_PK);
        address deployer = vm.addr(DEPLOYER_PK);

        ManagedVaultAdapter adapter = new ManagedVaultAdapter(REAL_VAULT);
        ConductRegistry registry = new ConductRegistry(deployer);
        VaultHealthFeed healthFeed = new VaultHealthFeed(deployer);
        StewardFactory factory =
            new StewardFactory(REAL_USDC, address(adapter), address(healthFeed), address(registry));

        registry.registerFactory(address(factory));
        healthFeed.registerReporter(deployer);

        // spec/health.md figures, Phase 0/Phase 3 measured values (docs/measurement-report.md,
        // spec/DECISIONS.md) — re-published fresh at deploy time (block.timestamp on the fork)
        // rather than hardcoding a stale ts, so the on-chain staleness check (maxStaleSec = 2
        // days, StewardAccount._readHealthCap) starts from a real "just published" state.
        healthFeed.publish(
            REAL_VAULT,
            VaultHealthFeed.HealthSnapshot({
                fromBlock: uint64(block.number),
                toBlock: uint64(block.number),
                ts: uint40(block.timestamp),
                method: Types.METHOD_REQUEST_FINALIZE_VIEW,
                n: 6,
                p50Sec: 926,
                p90Sec: 1_096_620,
                maxSec: 1_096_620,
                navPerShare: 1_091_152_000_000_000_000, // ~1.0912, docs/measurement-report.md
                drawdownBps: 0,
                codehash: bytes32(0),
                flags: 0,
                evidenceHash: bytes32(0)
            })
        );

        // leadFloorDays=14: the real p90 (~12.7 days) must not exceed mandate.leadFloorDays *
        // 1 days, or HealthMath halves capacity immediately — same reasoning as
        // contracts/test/fork/ModeA.t.sol's setUp().
        //
        // maxVaultUsdc/capacityCap are deliberately set to the account-level hardCap (1200e18),
        // not to T0's own 150e18 ceiling — the whole point of the demo is that the CURRENT
        // TIER is the binding constraint on growth (spec/tiers.md section 5: effective limit
        // = min(tier limit, mandate ceiling, ...)), not an arbitrary owner-set mandate cap.
        // Setting the mandate to T0's ceiling would make tier graduation invisible: capacity
        // would stay flat at 150e18 even after earning T1's 400e18 tier limit.
        Types.Mandate memory mandateA = Types.Mandate({
            maxTxUsdc: 1200e18,
            maxBps: 10000,
            maxVaultUsdc: 1200e18,
            minLiquidUsdc: 0,
            maxActionsPerDay: 100,
            expiry: uint40(block.timestamp + 365 days),
            loosenDelay: 1 days,
            issuerHaircutBps: 0,
            latencyHaircutBpsPerDay: 0,
            latencyHaircutMaxBps: 0,
            leadFloorDays: 14,
            approvalAbove: 1200e18 // demo: never trip NEEDS_APPROVAL, tier is the interesting constraint
        });
        Types.Envelope memory envelopeA =
            Types.Envelope({capacityCap: 1200e18, capCeiling: 1200e18, reserveUsdc: 0, paused: false});

        address accountA = factory.createAccount(OWNER_A, AGENT_A, GUARDIAN_A, 1200e18, mandateA, envelopeA, 0);

        vm.stopBroadcast();

        console2.log("adapter:", address(adapter));
        console2.log("registry:", address(registry));
        console2.log("healthFeed:", address(healthFeed));
        console2.log("factory:", address(factory));
        console2.log("accountA:", accountA);
        console2.log("deployer/admin:", deployer);

        string memory json = "deployed";
        vm.serializeAddress(json, "adapter", address(adapter));
        vm.serializeAddress(json, "registry", address(registry));
        vm.serializeAddress(json, "healthFeed", address(healthFeed));
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "accountA", accountA);
        vm.serializeAddress(json, "ownerA", OWNER_A);
        vm.serializeAddress(json, "agentA", AGENT_A);
        vm.serializeAddress(json, "guardianA", GUARDIAN_A);
        string memory finalJson = vm.serializeAddress(json, "deployer", deployer);
        vm.writeJson(finalJson, ".fork-state/deployed-addresses.json");
    }
}
