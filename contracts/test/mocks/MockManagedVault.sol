// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IManagedVault} from "../../src/interfaces/IManagedVault.sol";

/// @notice Mimics the real ManagedVault's essential behavior for isolated unit testing —
/// 1:1 NAV at deposit time (shares always mint 1:1 with assets in, matching Phase 0's
/// confirmed real-vault behavior), a test-adjustable `navBps` for simulating yield/loss
/// between deposit and redemption (NAV/health-cap *feed* behavior is tested separately via
/// VaultHealthFeed — this is about the redemption payout itself, needed to test the
/// fee-on-yield module at all: with NAV permanently pinned at 1:1, "gain" is structurally
/// impossible to produce in a test), request/finalize redemption model, whitelist and pause
/// switches, and the real vault's confirmed minimums. Not a full replica; see test/fork/ for
/// tests against the actual deployed contract.
contract MockManagedVault is ERC20, IManagedVault {
    using SafeERC20 for IERC20;

    IERC20 public immutable assetToken;
    address public operator;

    bool public whitelistEnabled_;
    bool public paused_;
    uint256 public minDepositAssets_ = 100e18;
    uint256 public minRedeemAssets_ = 100e18;
    // 1e18-scaled multiplier applied to a redemption's payout, e.g. 1.2e18 = shares worth
    // 20% more than they cost at deposit. Test-adjustable via setNavPerShare(); the vault
    // itself must actually hold enough assetToken to pay out above 1:1 — tests mint the
    // difference into it directly (MockERC20.mint is permissionless), the same way real
    // yield would show up as the vault's own balance growing from strategy performance.
    uint256 public navPerShare = 1e18;
    mapping(address => bool) public whitelist_;

    struct Request {
        address owner;
        address receiver;
        uint256 shares;
        uint256 priceAtRequest;
        uint256 feeBpsAtRequest;
        uint256 requestedAt;
        uint256 processedAt;
        RequestStatus status;
    }

    mapping(uint256 => Request) public requests;
    uint256 public nextRedeemRequestId_;
    uint256 public pendingRedeemCount_;
    uint256 public totalRedeemRequestCount_;

    constructor(address asset_) ERC20("Mock Managed Vault", "mMGV") {
        assetToken = IERC20(asset_);
        operator = msg.sender;
    }

    // --- Test helpers, not part of IManagedVault ---
    function setWhitelistEnabled(bool v) external {
        whitelistEnabled_ = v;
    }

    function setWhitelisted(address who, bool v) external {
        whitelist_[who] = v;
    }

    function setPaused(bool v) external {
        paused_ = v;
    }

    function setMinDepositAssets(uint256 v) external {
        minDepositAssets_ = v;
    }

    function setMinRedeemAssets(uint256 v) external {
        minRedeemAssets_ = v;
    }

    function setNavPerShare(uint256 v) external {
        navPerShare = v;
    }

    /// @dev Simulates the operator-only finalizeRedeem: pays out assets to the request's
    /// receiver and flips status to Finalized, matching Phase 0's observed real-vault
    /// behavior (automatic payout on finalize, no separate claim step).
    ///
    /// Confirmed 2026-09-23 against the real vault's actual verified source
    /// (github.com/IXS-Finance/vault-contracts, contracts/ManagedVault.sol — spec/DECISIONS.md
    /// "Phase 6, fourth item"): the real finalizeRedeem prices the payout using the LIVE
    /// `pricePerShare` at the moment finalize is called, NOT the price locked into the
    /// request struct at request time. `priceAtRequest` is stored there for audit-trail
    /// purposes only — the real contract's own struct comment says as much. This mock
    /// previously paid using `r.priceAtRequest`, which matched what StewardAccount's
    /// reconcileRedemption assumed at the time but not what the real vault actually does —
    /// both were wrong the same way, together, until this correction. See
    /// StewardAccount.sol's reconcileRedemption for the corresponding fix.
    function finalizeRedeem(uint256 id) external {
        require(msg.sender == operator, "not operator");
        Request storage r = requests[id];
        require(r.status == RequestStatus.Pending, "not pending");
        r.status = RequestStatus.Finalized;
        r.processedAt = block.timestamp;
        pendingRedeemCount_ -= 1;
        assetToken.safeTransfer(r.receiver, (r.shares * navPerShare) / 1e18);
    }

    function rejectRedeem(uint256 id) external {
        require(msg.sender == operator, "not operator");
        Request storage r = requests[id];
        require(r.status == RequestStatus.Pending, "not pending");
        r.status = RequestStatus.Rejected;
        r.processedAt = block.timestamp;
        pendingRedeemCount_ -= 1;
        _mint(r.owner, r.shares); // return shares on rejection
    }

    // --- IManagedVault ---
    function asset() external view returns (address) {
        return address(assetToken);
    }

    function decimals() public pure override(ERC20, IManagedVault) returns (uint8) {
        return 18;
    }

    function totalAssets() external view returns (uint256) {
        return assetToken.balanceOf(address(this));
    }

    function totalSupply() public view override(ERC20, IManagedVault) returns (uint256) {
        return super.totalSupply();
    }

    function availableAssets() external view returns (uint256) {
        return assetToken.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) external pure returns (uint256) {
        return assets;
    }

    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return (shares * navPerShare) / 1e18;
    }

    function minDepositAssets() external view returns (uint256) {
        return minDepositAssets_;
    }

    function minRedeemAssets() external view returns (uint256) {
        return minRedeemAssets_;
    }

    function whitelistEnabled() external view returns (bool) {
        return whitelistEnabled_;
    }

    function whitelist(address account) external view returns (bool) {
        return whitelist_[account];
    }

    function paused() external view returns (bool) {
        return paused_;
    }

    function _checkWhitelist(address account) internal view {
        if (whitelistEnabled_) require(whitelist_[account], "not whitelisted");
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(!paused_, "paused");
        require(assets >= minDepositAssets_, "below min deposit");
        _checkWhitelist(msg.sender);
        _checkWhitelist(receiver);
        assetToken.safeTransferFrom(msg.sender, address(this), assets);
        shares = assets; // 1:1 NAV
        _mint(receiver, shares);
    }

    function requestRedeem(uint256 shares, address receiver) external returns (uint256 id) {
        require(!paused_, "paused");
        require(shares > 0, "shares is zero");
        require(receiver != address(0), "receiver is zero");
        // Checked against the actual assets this redemption produces, not raw shares — those
        // only coincide while navPerShare is 1e18 (the default every existing test relies
        // on, so this is a no-op change for them; it matters once a test moves the NAV).
        require((shares * navPerShare) / 1e18 >= minRedeemAssets_, "below min redeem");
        _checkWhitelist(msg.sender);
        _checkWhitelist(receiver);

        _transfer(msg.sender, address(this), shares);
        _burn(address(this), shares);

        id = ++nextRedeemRequestId_;
        totalRedeemRequestCount_ += 1;
        pendingRedeemCount_ += 1;
        requests[id] = Request({
            owner: msg.sender,
            receiver: receiver,
            shares: shares,
            priceAtRequest: navPerShare,
            feeBpsAtRequest: 0,
            requestedAt: block.timestamp,
            processedAt: 0,
            status: RequestStatus.Pending
        });
    }

    function redeemRequests(uint256 id)
        external
        view
        returns (
            address owner,
            address receiver,
            uint256 shares,
            uint256 priceAtRequest,
            uint256 feeBpsAtRequest,
            uint256 requestedAt,
            uint256 processedAt,
            RequestStatus status
        )
    {
        Request memory r = requests[id];
        return (r.owner, r.receiver, r.shares, r.priceAtRequest, r.feeBpsAtRequest, r.requestedAt, r.processedAt, r.status);
    }

    function nextRedeemRequestId() external view returns (uint256) {
        return nextRedeemRequestId_;
    }

    function pendingRedeemCount() external view returns (uint256) {
        return pendingRedeemCount_;
    }

    function totalRedeemRequestCount() external view returns (uint256) {
        return totalRedeemRequestCount_;
    }
}
