// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {StewardFactory} from "../src/StewardFactory.sol";
import {ConductRegistry} from "../src/ConductRegistry.sol";
import {VaultHealthFeed} from "../src/VaultHealthFeed.sol";
import {ManagedVaultAdapter} from "../src/adapters/ManagedVaultAdapter.sol";
import {Types} from "../src/libraries/Types.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockManagedVault} from "../test/mocks/MockManagedVault.sol";

/// @notice Public BSC testnet deployment (chain 97) of the full Steward stack, so the
/// earned-authority mechanism can be checked on a block explorer. The real IXS vault exists
/// only on BSC mainnet, so this uses this repo's own mocks (test/mocks/): mock USDC (anyone can
/// mint) and a mock ManagedVault with the real vault's 100-unit minimum. The real-vault run is
/// the hosted fork (LIVE.md). Driven by scripts/testnet-demo.ts (`pnpm run deploy:testnet-demo`),
/// which supplies fresh throwaway keys through the environment; never Anvil's public keys,
/// which bots drain on public testnets.
contract DeployTestnet is Script {
    function run() external {
        // Guarded here too, not only in scripts/testnet-demo.ts: running this script directly
        // must never deploy anywhere but BSC testnet (no mainnet deployments from this repo).
        require(block.chainid == 97, "DeployTestnet: BSC testnet (chain 97) only");
        uint256 deployerPk = vm.envUint("TESTNET_DEPLOYER_PK");
        address ownerA = vm.envAddress("TESTNET_OWNER_A");
        address agentA = vm.envAddress("TESTNET_AGENT_A");
        address guardianA = vm.envAddress("TESTNET_GUARDIAN_A");
        address deployer = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);
        MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC");
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
        // Same mandate and envelope as the fork demo's Agent A (script/DeployDemo.s.sol), so the
        // tier, not the mandate, is what binds.
        Types.Mandate memory mandate = Types.Mandate({
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
            approvalAbove: 1200e18
        });
        Types.Envelope memory envelope =
            Types.Envelope({capacityCap: 1200e18, capCeiling: 1200e18, reserveUsdc: 0, paused: false});
        address accountA = factory.createAccount(ownerA, agentA, guardianA, 1200e18, mandate, envelope, 0);
        usdc.mint(accountA, 500e18);
        vm.stopBroadcast();

        string memory o = "deployed";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "deployBlock", block.number);
        vm.serializeAddress(o, "usdc", address(usdc));
        vm.serializeAddress(o, "vault", address(vault));
        vm.serializeAddress(o, "adapter", address(adapter));
        vm.serializeAddress(o, "registry", address(registry));
        vm.serializeAddress(o, "healthFeed", address(healthFeed));
        vm.serializeAddress(o, "factory", address(factory));
        string memory json = vm.serializeAddress(o, "accountA", accountA);
        vm.writeJson(json, "../deploy/testnet/deployed.json");
    }
}
