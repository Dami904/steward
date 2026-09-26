// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StewardFactory} from "../../src/StewardFactory.sol";
import {StewardAccount} from "../../src/StewardAccount.sol";
import {ConductRegistry} from "../../src/ConductRegistry.sol";
import {VaultHealthFeed} from "../../src/VaultHealthFeed.sol";
import {ManagedVaultAdapter} from "../../src/adapters/ManagedVaultAdapter.sol";
import {Types} from "../../src/libraries/Types.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockManagedVault} from "../mocks/MockManagedVault.sol";

contract StewardFactoryTest is Test {
    MockERC20 usdc;
    MockManagedVault vault;
    ManagedVaultAdapter adapter;
    ConductRegistry registry;
    VaultHealthFeed healthFeed;
    StewardFactory factory;

    address admin = makeAddr("admin");
    address owner = makeAddr("owner");
    address agentKey = makeAddr("agent");
    address guardian = makeAddr("guardian");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC");
        vault = new MockManagedVault(address(usdc));
        adapter = new ManagedVaultAdapter(address(vault));
        registry = new ConductRegistry(admin);
        healthFeed = new VaultHealthFeed(admin);
        factory = new StewardFactory(address(usdc), address(adapter), address(healthFeed), address(registry));

        vm.prank(admin);
        registry.registerFactory(address(factory));
    }

    function test_constructor_reverts_on_any_zero_address() public {
        vm.expectRevert(bytes("StewardFactory: zero address"));
        new StewardFactory(address(0), address(adapter), address(healthFeed), address(registry));
    }

    function _mandate() internal view returns (Types.Mandate memory) {
        return Types.Mandate({
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
    }

    function _envelope() internal pure returns (Types.Envelope memory) {
        return Types.Envelope({capacityCap: 1000e18, capCeiling: 1200e18, reserveUsdc: 0, paused: false});
    }

    function test_stranger_agent_starts_at_tier_zero() public {
        address acct = factory.createAccount(owner, agentKey, guardian, 1200e18, _mandate(), _envelope(), 3);
        (uint8 tier,,,,,,,,,) = StewardAccount(acct).tierState();
        assertEq(tier, 0);
    }

    function test_start_tier_capped_by_maxStartTier_even_with_a_qualifying_record() public {
        // Build a record that would qualify tierFor() for T1 (2 distinct owners, enough risk
        // units, no incidents): mark two fake addresses as factory-created accounts (a
        // legitimate ConductRegistry-level shortcut — it only cares that msg.sender is
        // trusted, not that it's a real StewardAccount) and have each report once.
        address fake1 = makeAddr("fakeAccount1");
        address fake2 = makeAddr("fakeAccount2");
        vm.startPrank(address(factory));
        registry.recordAccountCreated(agentKey, fake1);
        registry.recordAccountCreated(agentKey, fake2);
        vm.stopPrank();
        vm.prank(fake1);
        registry.report(agentKey, makeAddr("ownerA"), 0, 30, false);
        vm.prank(fake2);
        registry.report(agentKey, makeAddr("ownerB"), 0, 0, false);

        assertEq(factory.tierFor(registry.recordOf(agentKey)), 1, "record now qualifies for T1");

        address acctCapped = factory.createAccount(owner, agentKey, guardian, 1200e18, _mandate(), _envelope(), 0);
        (uint8 tier,,,,,,,,,) = StewardAccount(acctCapped).tierState();
        assertEq(tier, 0, "maxStartTier=0 still forces T0 despite the qualifying record");

        address acctUncapped = factory.createAccount(owner, agentKey, guardian, 1200e18, _mandate(), _envelope(), 3);
        (uint8 tier2,,,,,,,,,) = StewardAccount(acctUncapped).tierState();
        assertEq(tier2, 1, "maxStartTier=3 lets the qualifying record's T1 through");
    }

    function test_tierFor_pure_logic_thresholds() public view {
        ConductRegistry.Record memory clean2Owners = ConductRegistry.Record({
            accountsCount: 2,
            distinctOwnersCount: 2,
            totalRiskUnits: 30,
            incidentCount: 0,
            maxTierReached: 0,
            firstSeen: 1,
            cleanStreakStart: 1
        });
        assertEq(factory.tierFor(clean2Owners), 1, "2 owners + enough risk units qualifies T1");

        ConductRegistry.Record memory clean3Owners = ConductRegistry.Record({
            accountsCount: 3,
            distinctOwnersCount: 3,
            totalRiskUnits: 100,
            incidentCount: 0,
            maxTierReached: 0,
            firstSeen: 1,
            cleanStreakStart: 1
        });
        assertEq(factory.tierFor(clean3Owners), 2, "3 owners + enough risk units qualifies T2");

        ConductRegistry.Record memory withIncident = clean3Owners;
        withIncident.incidentCount = 1;
        assertEq(factory.tierFor(withIncident), 0, "any incident forces T0 regardless of owners/risk");

        ConductRegistry.Record memory oneOwner = ConductRegistry.Record({
            accountsCount: 1,
            distinctOwnersCount: 1,
            totalRiskUnits: 1000,
            incidentCount: 0,
            maxTierReached: 0,
            firstSeen: 1,
            cleanStreakStart: 1
        });
        assertEq(factory.tierFor(oneOwner), 0, "a single owner never qualifies above T0, regardless of risk units");

        ConductRegistry.Record memory empty;
        assertEq(factory.tierFor(empty), 0, "a stranger (empty record) starts at T0");
    }

    function test_createAccount_registers_with_conduct_registry() public {
        address acct = factory.createAccount(owner, agentKey, guardian, 1200e18, _mandate(), _envelope(), 0);
        assertTrue(registry.isFactoryCreatedAccount(acct));
    }

    function test_createAccount_wires_roles_correctly() public {
        address acct = factory.createAccount(owner, agentKey, guardian, 1200e18, _mandate(), _envelope(), 0);
        StewardAccount sa = StewardAccount(acct);
        assertEq(sa.owner(), owner);
        assertEq(sa.agent(), agentKey);
        assertEq(sa.guardian(), guardian);
    }
}
