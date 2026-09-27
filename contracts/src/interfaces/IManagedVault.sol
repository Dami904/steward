// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Interface for the real IXS vault at 0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82
/// (BSC mainnet), contract name `ManagedVault`. Reconstructed from its verified source via
/// BscScan when first verifying the real vault.
/// This is NOT a generic ERC-4626/ERC-7540 interface — the real vault has its own
/// request/finalize redemption model, which is why /spec/health.md defines the
/// REQUEST_FINALIZE_VIEW method instead of assuming ERC-7540.
interface IManagedVault {
    enum RequestStatus {
        None,
        Pending,
        Finalized,
        Rejected
    }

    function asset() external view returns (address);
    function decimals() external view returns (uint8);
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function availableAssets() external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);

    function minDepositAssets() external view returns (uint256);
    function minRedeemAssets() external view returns (uint256);
    function whitelistEnabled() external view returns (bool);
    function whitelist(address account) external view returns (bool);
    function paused() external view returns (bool);

    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function requestRedeem(uint256 shares, address receiver) external returns (uint256 id);

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
        );
    function nextRedeemRequestId() external view returns (uint256);
    function pendingRedeemCount() external view returns (uint256);
    function totalRedeemRequestCount() external view returns (uint256);
}
