// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ConductRegistry} from "../../src/ConductRegistry.sol";

contract ConductRegistryTest is Test {
    ConductRegistry registry;
    address admin = makeAddr("admin");
    address factory = makeAddr("factory");
    address strangerFactory = makeAddr("strangerFactory");
    address account1 = makeAddr("account1");
    address agent = makeAddr("agent");
    address owner1 = makeAddr("owner1");
    address owner2 = makeAddr("owner2");

    function setUp() public {
        registry = new ConductRegistry(admin);
        vm.prank(admin);
        registry.registerFactory(factory);
    }

    function test_constructor_reverts_on_zero_admin() public {
        vm.expectRevert(bytes("ConductRegistry: zero admin"));
        new ConductRegistry(address(0));
    }

    function test_only_admin_can_register_factory() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(ConductRegistry.NotAdmin.selector);
        registry.registerFactory(strangerFactory);
    }

    function test_recordAccountCreated_reverts_from_unregistered_factory() public {
        vm.prank(strangerFactory);
        vm.expectRevert(ConductRegistry.NotRegisteredFactory.selector);
        registry.recordAccountCreated(agent, account1);
    }

    function test_report_reverts_from_non_factory_created_account() public {
        // account1 was never registered via recordAccountCreated by any factory.
        vm.prank(account1);
        vm.expectRevert(ConductRegistry.NotFactoryCreatedAccount.selector);
        registry.report(agent, owner1, 1, 10, false);
    }

    /// @dev Direct proof of the fix: a contract cannot forge its own provenance by simply
    /// naming a registered factory — report() only trusts what THIS contract itself recorded
    /// via recordAccountCreated, not a caller-supplied claim.
    function test_report_cannot_be_spoofed_by_naming_a_registered_factory() public {
        address attacker = makeAddr("attacker");
        // attacker was never actually created by `factory` — recordAccountCreated was never
        // called for it. It cannot make itself trusted just by being a contract; report()
        // still checks isFactoryCreatedAccount[msg.sender], which is false here.
        vm.prank(attacker);
        vm.expectRevert(ConductRegistry.NotFactoryCreatedAccount.selector);
        registry.report(agent, owner1, 1, 999, false);
    }

    function test_report_from_factory_created_account_updates_record() public {
        vm.prank(factory);
        registry.recordAccountCreated(agent, account1);

        vm.prank(account1);
        registry.report(agent, owner1, 1, 30, false);

        ConductRegistry.Record memory r = registry.recordOf(agent);
        assertEq(r.distinctOwnersCount, 1);
        assertEq(r.totalRiskUnits, 30);
        assertEq(r.maxTierReached, 1);
        assertEq(r.incidentCount, 0);
        assertGt(r.firstSeen, 0);
    }

    function test_distinctOwnersCount_counts_each_owner_once() public {
        vm.prank(factory);
        registry.recordAccountCreated(agent, account1);

        vm.startPrank(account1);
        registry.report(agent, owner1, 0, 5, false);
        registry.report(agent, owner1, 0, 5, false); // same owner again
        registry.report(agent, owner2, 0, 5, false); // a distinct owner
        vm.stopPrank();

        ConductRegistry.Record memory r = registry.recordOf(agent);
        assertEq(r.distinctOwnersCount, 2);
        assertEq(r.totalRiskUnits, 15);
    }

    function test_maxTierReached_is_monotonic() public {
        vm.prank(factory);
        registry.recordAccountCreated(agent, account1);

        vm.startPrank(account1);
        registry.report(agent, owner1, 2, 0, false);
        registry.report(agent, owner1, 1, 0, false); // demotion afterwards
        vm.stopPrank();

        ConductRegistry.Record memory r = registry.recordOf(agent);
        assertEq(r.maxTierReached, 2, "max tier reached never decreases");
    }

    function test_incident_increments_incidentCount() public {
        vm.prank(factory);
        registry.recordAccountCreated(agent, account1);

        vm.prank(account1);
        registry.report(agent, owner1, 0, 0, true);

        ConductRegistry.Record memory r = registry.recordOf(agent);
        assertEq(r.incidentCount, 1);
    }

    function test_revokeFactory_blocks_further_account_creation() public {
        vm.prank(admin);
        registry.revokeFactory(factory);

        vm.prank(factory);
        vm.expectRevert(ConductRegistry.NotRegisteredFactory.selector);
        registry.recordAccountCreated(agent, account1);
    }

    function test_revoking_factory_does_not_retroactively_untrust_existing_accounts() public {
        vm.prank(factory);
        registry.recordAccountCreated(agent, account1);

        vm.prank(admin);
        registry.revokeFactory(factory);

        // account1's own isFactoryCreatedAccount flag was already set and is not revisited;
        // it can still report. This is documented behavior, not an oversight: revoking a
        // factory stops it minting new trusted accounts, it doesn't retroactively distrust
        // accounts it already vouched for.
        vm.prank(account1);
        registry.report(agent, owner1, 0, 1, false);
    }
}
