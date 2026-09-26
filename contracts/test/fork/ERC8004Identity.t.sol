// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StewardAccount} from "../../src/StewardAccount.sol";
import {StewardFactory} from "../../src/StewardFactory.sol";
import {ConductRegistry} from "../../src/ConductRegistry.sol";
import {VaultHealthFeed} from "../../src/VaultHealthFeed.sol";
import {ManagedVaultAdapter} from "../../src/adapters/ManagedVaultAdapter.sol";
import {ERC8004IdentityBridge} from "../../src/adapters/ERC8004IdentityBridge.sol";
import {IERC8004IdentityRegistry} from "../../src/interfaces/IERC8004IdentityRegistry.sol";
import {Types} from "../../src/libraries/Types.sol";

/// @notice ERC-8004 identity registration against the REAL, deployed IdentityRegistry on BSC
/// mainnet (spec/DECISIONS.md "Phase 6, fifth item") — same zero-funds/fork-only discipline
/// as test/fork/ModeA.t.sol: run entirely against a local `forge test --fork-url` state fork,
/// no transaction ever broadcast to live BSC, no real funds spent (registration costs only
/// gas, and even that is fork-local, paid from the test's own cheatcode-funded balance).
///
/// Address confirmed real and deployed (not assumed): `cast code
/// 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 --rpc-url https://bsc-dataseed.binance.org`
/// returned real bytecode, 2026-09-23. Interface reconstructed from the actual verified
/// source (github.com/erc-8004/erc-8004-contracts), not the EIP prose alone.
///
/// Requires network access to run; skipped entirely otherwise. Run with:
/// forge test --match-path "test/fork/ERC8004Identity.t.sol" --fork-url https://bsc-dataseed.binance.org
contract ERC8004IdentityForkTest is Test {
    address constant REAL_IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant REAL_USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;
    address constant REAL_VAULT = 0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82;

    ManagedVaultAdapter adapter;
    ConductRegistry registry;
    VaultHealthFeed healthFeed;
    StewardFactory factory;
    StewardAccount account;
    ERC8004IdentityBridge bridge;

    address admin = makeAddr("admin");
    address owner = makeAddr("owner");
    address agentKey = makeAddr("agent");
    address guardian = makeAddr("guardian");
    address stranger = makeAddr("stranger");

    string constant AGENT_URI = "https://example.com/steward-agent-registration.json";

    function setUp() public {
        adapter = new ManagedVaultAdapter(REAL_VAULT);
        registry = new ConductRegistry(admin);
        healthFeed = new VaultHealthFeed(admin);
        factory = new StewardFactory(REAL_USDC, address(adapter), address(healthFeed), address(registry));

        vm.prank(admin);
        registry.registerFactory(address(factory));

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
            leadFloorDays: 14,
            approvalAbove: 500e18
        });
        Types.Envelope memory envelope =
            Types.Envelope({capacityCap: 1200e18, capCeiling: 1200e18, reserveUsdc: 0, paused: false});

        vm.prank(owner);
        address acct = factory.createAccount(owner, agentKey, guardian, 1200e18, mandate, envelope, 0);
        account = StewardAccount(acct);

        bridge = new ERC8004IdentityBridge(REAL_IDENTITY_REGISTRY, address(account));
    }

    function test_real_identity_registry_has_real_deployed_code() public view {
        assertGt(REAL_IDENTITY_REGISTRY.code.length, 0, "must be a real deployed contract, not an EOA or unused address");
    }

    /// @dev The single most important fork test: proves registration actually succeeds
    /// against the real, live IdentityRegistry — not just that the interface compiles.
    function test_bridge_can_register_a_real_agent_identity() public {
        vm.prank(owner);
        uint256 agentId = bridge.register(AGENT_URI);

        assertGt(agentId, 0, "the real registry must return a nonzero agentId");
        assertEq(bridge.agentId(), agentId);
        assertTrue(bridge.registered());
        assertEq(
            IERC8004IdentityRegistry(REAL_IDENTITY_REGISTRY).ownerOf(agentId),
            address(bridge),
            "the bridge (not the account owner directly) must hold the real NFT, per its own design comment"
        );
        assertEq(IERC8004IdentityRegistry(REAL_IDENTITY_REGISTRY).tokenURI(agentId), AGENT_URI);
    }

    function test_register_reverts_when_not_account_owner() public {
        vm.prank(stranger);
        vm.expectRevert(ERC8004IdentityBridge.NotAccountOwner.selector);
        bridge.register(AGENT_URI);
    }

    function test_register_reverts_on_second_call() public {
        vm.prank(owner);
        bridge.register(AGENT_URI);

        vm.prank(owner);
        vm.expectRevert(ERC8004IdentityBridge.AlreadyRegistered.selector);
        bridge.register("https://example.com/different-uri.json");
    }

    function test_updateAgentURI_reverts_before_registration() public {
        vm.prank(owner);
        vm.expectRevert(ERC8004IdentityBridge.NotRegisteredYet.selector);
        bridge.updateAgentURI(AGENT_URI);
    }

    function test_updateAgentURI_reverts_when_not_account_owner() public {
        vm.prank(owner);
        bridge.register(AGENT_URI);

        vm.prank(stranger);
        vm.expectRevert(ERC8004IdentityBridge.NotAccountOwner.selector);
        bridge.updateAgentURI("https://example.com/different-uri.json");
    }

    function test_updateAgentURI_succeeds_against_the_real_registry() public {
        vm.prank(owner);
        uint256 agentId = bridge.register(AGENT_URI);

        string memory newURI = "https://example.com/updated-registration.json";
        vm.prank(owner);
        bridge.updateAgentURI(newURI);

        assertEq(IERC8004IdentityRegistry(REAL_IDENTITY_REGISTRY).tokenURI(agentId), newURI);
    }
}
