// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StewardAccount} from "../../src/StewardAccount.sol";
import {StewardFactory} from "../../src/StewardFactory.sol";
import {ConductRegistry} from "../../src/ConductRegistry.sol";
import {VaultHealthFeed} from "../../src/VaultHealthFeed.sol";
import {ManagedVaultAdapter} from "../../src/adapters/ManagedVaultAdapter.sol";
import {IManagedVault} from "../../src/interfaces/IManagedVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Types} from "../../src/libraries/Types.sol";

/// @notice Mode A verification against the REAL IXS vault, run
/// entirely against a local `forge test --fork-url` state fork — no transaction is ever
/// broadcast to live BSC, no real funds are spent. `deal()` (a Foundry cheatcode) writes a
/// fake USDC balance directly into this fork's local storage; nothing about that is visible
/// to or affects the real chain. This closes the "not yet measured: behavior of
/// deposit()/requestRedeem() from an arbitrary contract caller" gap noted in
/// docs/API_NOTES.md.
///
/// Requires BSC_RPC_URL (see .env.example) and network access to run; skipped entirely
/// otherwise. Run with: forge test --match-path "test/fork/*.t.sol" --fork-url $BSC_RPC_URL
contract ModeAForkTest is Test {
    address constant REAL_VAULT = 0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82;
    address constant REAL_USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;

    ManagedVaultAdapter adapter;
    ConductRegistry registry;
    VaultHealthFeed healthFeed;
    StewardFactory factory;
    StewardAccount account;

    address admin = makeAddr("admin");
    address owner = makeAddr("owner");
    address agentKey = makeAddr("agent");
    address guardian = makeAddr("guardian");

    function setUp() public {
        adapter = new ManagedVaultAdapter(REAL_VAULT);
        registry = new ConductRegistry(admin);
        healthFeed = new VaultHealthFeed(admin);
        factory = new StewardFactory(REAL_USDC, address(adapter), address(healthFeed), address(registry));

        vm.prank(admin);
        registry.registerFactory(address(factory));
        vm.prank(admin);
        healthFeed.registerReporter(admin);
        vm.prank(admin);
        healthFeed.publish(
            REAL_VAULT,
            VaultHealthFeed.HealthSnapshot({
                fromBlock: uint64(block.number),
                toBlock: uint64(block.number),
                ts: uint40(block.timestamp),
                method: Types.METHOD_REQUEST_FINALIZE_VIEW,
                n: 6,
                p50Sec: 3600,
                p90Sec: 1_100_000, // real Phase 0 sample's max latency (~304.6h) rounded
                maxSec: 1_100_000,
                navPerShare: 1e18,
                drawdownBps: 0,
                codehash: bytes32(0),
                flags: 0,
                evidenceHash: bytes32(0)
            })
        );

        // Real vault minimums (Phase 0: 100 units) — floors already carry the fix.
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
            leadFloorDays: 14, // real p90 is multi-day; a 2-day mandate assumption would
                // immediately halve the health cap via HealthMath — set realistically here.
            approvalAbove: 500e18
        });
        Types.Envelope memory envelope =
            Types.Envelope({capacityCap: 1200e18, capCeiling: 1200e18, reserveUsdc: 0, paused: false});

        vm.prank(owner);
        address acct = factory.createAccount(owner, agentKey, guardian, 1200e18, mandate, envelope, 0);
        account = StewardAccount(acct);

        // Zero-funds testing: deal() writes directly into this fork's local storage. No real
        // USDC is spent, and nothing here is visible to or affects live BSC.
        deal(REAL_USDC, address(account), 1000e18);
    }

    function test_real_vault_ground_truth_matches_phase0_findings() public view {
        IManagedVault vault = IManagedVault(REAL_VAULT);
        assertEq(vault.asset(), REAL_USDC, "asset() must match Phase 0's confirmed USDC address");
        assertEq(vault.decimals(), 18, "Phase 0 confirmed 18 decimals, not 6");
        assertFalse(vault.whitelistEnabled(), "Phase 0 found whitelist currently disabled (Mode A gate)");
    }

    /// @dev The single most important fork test: proves an arbitrary contract (StewardAccount,
    /// via its adapter) can actually deposit into the real, live vault — confirming Mode A
    /// beyond the read-only whitelistEnabled() check Phase 0 did. Re-run this close to any
    /// real deployment decision, since whitelistEnabled() is admin-mutable at any time.
    function test_stewardAccount_can_deposit_into_the_real_vault() public {
        uint256 sharesBefore = IERC20(REAL_VAULT).balanceOf(address(account));

        vm.prank(agentKey);
        account.deposit(120e18, 1, bytes32("fork-test-deposit"), 0, "");

        uint256 sharesAfter = IERC20(REAL_VAULT).balanceOf(address(account));
        assertGt(sharesAfter, sharesBefore, "StewardAccount must hold real vault shares after a real deposit");
        assertEq(account.exposure(), 120e18);
    }

    /// @dev A stranger contract with no earned tier and a tiny mandate should still be
    /// rejected below the vault's own 100-unit minimum — confirms the Phase 0 fix (raised
    /// tier floors) actually matters against the real vault's real minDepositAssets(), not
    /// just against the mock in unit tests.
    function test_deposit_below_real_vault_minimum_reverts() public {
        vm.prank(agentKey);
        vm.expectRevert(StewardAccount.BelowVaultMinimum.selector);
        account.deposit(50e18, 1, bytes32("too-small"), 0, "");
    }

    /// @dev Confirms the real vault's redemption request/finalize interface matches
    /// IManagedVault exactly — a StewardAccount can request a redemption after depositing.
    ///
    /// The real vault's share price is not 1:1 (Phase 0: pricePerShare ~= 1.0912) — the mock
    /// used elsewhere simplifies to 1:1 NAV, but this fork test hits the real contract, so it
    /// must redeem whatever share balance depositing 120e18 assets actually minted, not
    /// assume it equals 120e18 shares. (First run of this exact test caught that assumption
    /// as a real bug in the test itself: depositing 120e18 assets minted ~109.98e18 shares.)
    function test_stewardAccount_can_requestRedeem_from_the_real_vault() public {
        vm.prank(agentKey);
        account.deposit(120e18, 1, bytes32("d1"), 0, "");

        uint256 sharesHeld = IERC20(REAL_VAULT).balanceOf(address(account));
        assertLt(sharesHeld, 120e18, "sanity: real share price is above 1, so shares < assets deposited");

        vm.prank(agentKey);
        uint256 reqId = account.requestRedeem(uint128(sharesHeld), 2, bytes32("rr1"), 0, "");
        assertGt(reqId, 0, "the real vault must return a nonzero request id");

        (,,,,,,, IManagedVault.RequestStatus status) = IManagedVault(REAL_VAULT).redeemRequests(reqId);
        assertTrue(status == IManagedVault.RequestStatus.Pending, "request should be pending, awaiting operator finalize");
    }
}
