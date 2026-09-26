// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VaultHealthFeed} from "../../src/VaultHealthFeed.sol";
import {Types} from "../../src/libraries/Types.sol";

contract VaultHealthFeedTest is Test {
    VaultHealthFeed feed;
    address admin = makeAddr("admin");
    address reporter = makeAddr("reporter");
    address strangerReporter = makeAddr("strangerReporter");
    address vault = makeAddr("vault");

    function setUp() public {
        feed = new VaultHealthFeed(admin);
        vm.prank(admin);
        feed.registerReporter(reporter);
    }

    function _snapshot() internal view returns (VaultHealthFeed.HealthSnapshot memory) {
        return VaultHealthFeed.HealthSnapshot({
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
        });
    }

    function test_constructor_reverts_on_zero_admin() public {
        vm.expectRevert(bytes("VaultHealthFeed: zero admin"));
        new VaultHealthFeed(address(0));
    }

    function test_only_admin_can_register_reporter() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(VaultHealthFeed.NotAdmin.selector);
        feed.registerReporter(strangerReporter);
    }

    function test_publish_reverts_from_unregistered_reporter() public {
        vm.prank(strangerReporter);
        vm.expectRevert(VaultHealthFeed.NotRegisteredReporter.selector);
        feed.publish(vault, _snapshot());
    }

    function test_publish_and_read_back() public {
        VaultHealthFeed.HealthSnapshot memory s = _snapshot();
        vm.prank(reporter);
        feed.publish(vault, s);

        (VaultHealthFeed.HealthSnapshot memory got, uint64 id) = feed.healthOf(vault);
        assertEq(got.n, 6);
        assertEq(got.p90Sec, 7200);
        assertEq(id, 1);
    }

    function test_healthOf_unpublished_vault_returns_zero_value_default() public {
        (VaultHealthFeed.HealthSnapshot memory got, uint64 id) = feed.healthOf(makeAddr("neverPublished"));
        assertEq(got.ts, 0);
        assertEq(id, 0);
    }

    function test_ids_increment_across_publishes() public {
        vm.startPrank(reporter);
        feed.publish(vault, _snapshot());
        feed.publish(vault, _snapshot());
        vm.stopPrank();

        (, uint64 id) = feed.healthOf(vault);
        assertEq(id, 2);
    }

    function test_revoked_reporter_can_no_longer_publish() public {
        vm.prank(admin);
        feed.revokeReporter(reporter);

        vm.prank(reporter);
        vm.expectRevert(VaultHealthFeed.NotRegisteredReporter.selector);
        feed.publish(vault, _snapshot());
    }
}
