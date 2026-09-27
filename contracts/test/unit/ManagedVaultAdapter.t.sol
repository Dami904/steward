// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ManagedVaultAdapter} from "../../src/adapters/ManagedVaultAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockManagedVault} from "../mocks/MockManagedVault.sol";

/// @notice Isolated coverage of ManagedVaultAdapter.recoverRejectedShares' two access-control
/// guards (NotRequestReceiver, AlreadyRecovered). A reliability-auditor follow-up pass
/// found both guards logically
/// sound by hand-tracing, but with no test that would fail if either were deleted — every
/// existing call path only ever reaches this function as the correct, first-time receiver, so
/// nothing exercised the two revert branches in isolation. This file does, going straight
/// through the adapter (not via StewardAccount), the way the auditor's suggested fix framed
/// it: "a two-account (or direct-adapter, arbitrary-caller) test."
contract ManagedVaultAdapterTest is Test {
    MockERC20 usdc;
    MockManagedVault vault;
    ManagedVaultAdapter adapter;

    address receiverAccount = makeAddr("receiverAccount");
    address stranger = makeAddr("stranger");

    uint256 constant AMOUNT = 100e18;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC");
        vault = new MockManagedVault(address(usdc));
        adapter = new ManagedVaultAdapter(address(vault));
    }

    /// @dev Deposits and requests a redemption directly through the adapter, exactly as
    /// StewardAccount would, but with `receiverAccount` as both the caller and the receiver —
    /// isolating the adapter's own guards from StewardAccount's requestReconciled gate, which
    /// would otherwise mask AlreadyRecovered/NotRequestReceiver on a second call.
    function _requestAndReject() internal returns (uint256 requestId) {
        usdc.mint(receiverAccount, AMOUNT);
        vm.prank(receiverAccount);
        usdc.approve(address(adapter), AMOUNT);
        vm.prank(receiverAccount);
        adapter.deposit(AMOUNT, receiverAccount); // vault mints shares directly to receiverAccount

        vm.prank(receiverAccount);
        vault.approve(address(adapter), AMOUNT);
        vm.prank(receiverAccount);
        requestId = adapter.requestRedeem(AMOUNT, receiverAccount);

        vault.rejectRedeem(requestId); // test contract deployed the vault, so it's the operator
    }

    function test_recoverRejectedShares_reverts_for_a_request_that_is_still_pending() public {
        usdc.mint(receiverAccount, AMOUNT);
        vm.prank(receiverAccount);
        usdc.approve(address(adapter), AMOUNT);
        vm.prank(receiverAccount);
        adapter.deposit(AMOUNT, receiverAccount);

        vm.prank(receiverAccount);
        vault.approve(address(adapter), AMOUNT);
        vm.prank(receiverAccount);
        uint256 requestId = adapter.requestRedeem(AMOUNT, receiverAccount);
        // Never rejected or finalized — still Pending.

        vm.prank(receiverAccount);
        vm.expectRevert(ManagedVaultAdapter.NotRejected.selector);
        adapter.recoverRejectedShares(requestId);
    }

    /// @dev The exact guard the follow-up audit found untested: an address that is NOT the
    /// request's own receiver (a different account sharing this same adapter, or any arbitrary
    /// caller) must never be able to pull out shares it doesn't own.
    function test_recoverRejectedShares_reverts_for_a_caller_that_is_not_the_receiver() public {
        uint256 requestId = _requestAndReject();

        vm.prank(stranger);
        vm.expectRevert(ManagedVaultAdapter.NotRequestReceiver.selector);
        adapter.recoverRejectedShares(requestId);

        // Confirm it's still recoverable by the RIGHT caller afterward — the failed attempt
        // above didn't corrupt the request's state.
        vm.prank(receiverAccount);
        adapter.recoverRejectedShares(requestId);
        assertEq(vault.balanceOf(receiverAccount), AMOUNT);
    }

    /// @dev The other guard the follow-up audit found untested: a second recovery attempt for
    /// the same request, even by the legitimate receiver, must never succeed twice.
    function test_recoverRejectedShares_reverts_on_double_recovery() public {
        uint256 requestId = _requestAndReject();

        vm.prank(receiverAccount);
        adapter.recoverRejectedShares(requestId);

        vm.prank(receiverAccount);
        vm.expectRevert(ManagedVaultAdapter.AlreadyRecovered.selector);
        adapter.recoverRejectedShares(requestId);
    }

    function test_recoverRejectedShares_forwards_exact_share_amount() public {
        uint256 requestId = _requestAndReject();
        assertEq(vault.balanceOf(address(adapter)), AMOUNT, "vault minted the rejection's shares to the adapter");

        vm.prank(receiverAccount);
        uint256 shares = adapter.recoverRejectedShares(requestId);

        assertEq(shares, AMOUNT, "returns the exact recovered amount");
        assertEq(vault.balanceOf(receiverAccount), AMOUNT, "receiver gets exactly its own shares back");
        assertEq(vault.balanceOf(address(adapter)), 0, "nothing left behind in the shared adapter");
    }
}
