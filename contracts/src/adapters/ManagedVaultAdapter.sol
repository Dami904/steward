// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVaultAdapter} from "../interfaces/IVaultAdapter.sol";
import {IManagedVault} from "../interfaces/IManagedVault.sol";

/// @notice Adapter for the real IXS ManagedVault (see IManagedVault.sol). Pass-through only
/// — holds no state-changing custody of its own beyond the single call it's forwarding.
/// Mode A (checked against the real vault): whitelistEnabled() currently reads false, so an
/// arbitrary contract (this adapter, called by StewardAccount) can deposit directly.
contract ManagedVaultAdapter is IVaultAdapter {
    using SafeERC20 for IERC20;

    IManagedVault public immutable vaultContract;
    IERC20 public immutable assetToken;
    IERC20 public immutable shareToken; // ManagedVault is itself the ERC20 share token.

    // Guards recoverRejectedShares against being called twice for the same request — the
    // vault mints a rejection's shares to this adapter exactly once; nothing else about the
    // vault's own state changes after that to signal "already handled" on its own.
    mapping(uint256 => bool) public rejectedSharesRecovered;

    error NotRejected();
    error NotRequestReceiver();
    error AlreadyRecovered();

    constructor(address vault_) {
        vaultContract = IManagedVault(vault_);
        assetToken = IERC20(vaultContract.asset());
        shareToken = IERC20(vault_);
    }

    function vault() external view returns (address) {
        return address(vaultContract);
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    /// @dev Caller (StewardAccount) must have approved this adapter for `assets` of the
    /// underlying asset token beforehand. Shares are minted directly to `onBehalfOf`, never
    /// held by this adapter.
    function deposit(uint256 assets, address onBehalfOf) external returns (uint256 shares) {
        assetToken.safeTransferFrom(msg.sender, address(this), assets);
        assetToken.forceApprove(address(vaultContract), assets);
        shares = vaultContract.deposit(assets, onBehalfOf);
    }

    /// @dev Caller must have approved this adapter for `shares` of the vault's own share
    /// token beforehand. The vault's requestRedeem pulls from msg.sender (this adapter), so
    /// the adapter must briefly hold the shares between the pull and the forward.
    function requestRedeem(uint256 shares, address onBehalfOf) external returns (uint256 requestId) {
        shareToken.safeTransferFrom(msg.sender, address(this), shares);
        requestId = vaultContract.requestRedeem(shares, onBehalfOf);
    }

    /// @dev onchain-access-control skill, check 3: recompute the verdict (status, the
    /// rightful receiver, the share amount) from the vault's own redeemRequests record — this
    /// adapter keeps no parallel bookkeeping of its own that could drift from it.
    function recoverRejectedShares(uint256 requestId) external returns (uint256 shares) {
        (, address receiver, uint256 reqShares,,,,, IManagedVault.RequestStatus status) =
            // forge-lint: disable-next-line(unused-return)
            vaultContract.redeemRequests(requestId);
        if (status != IManagedVault.RequestStatus.Rejected) revert NotRejected();
        if (msg.sender != receiver) revert NotRequestReceiver();
        if (rejectedSharesRecovered[requestId]) revert AlreadyRecovered();

        rejectedSharesRecovered[requestId] = true;
        shares = reqShares;
        shareToken.safeTransfer(receiver, shares);
    }

    function navPerShare() external view returns (uint256) {
        // ManagedVault has no direct pricePerShare() in the interface we declared; derive
        // it the same way Phase 0 did: convertToAssets(1e18) with 18-decimal shares.
        return vaultContract.convertToAssets(1e18);
    }

    function sharesOf(address account) external view returns (uint256) {
        return shareToken.balanceOf(account);
    }

    function minDepositAssets() external view returns (uint256) {
        return vaultContract.minDepositAssets();
    }

    function minRedeemAssets() external view returns (uint256) {
        return vaultContract.minRedeemAssets();
    }

    function previewRedeemAssets(uint256 shares) external view returns (uint256) {
        return vaultContract.previewRedeem(shares);
    }
}
