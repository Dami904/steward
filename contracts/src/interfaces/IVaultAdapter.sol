// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Isolates vault specifics from StewardAccount.
/// StewardAccount only ever calls through this interface — it never holds vault-specific
/// knowledge, so a different vault (or Mode B) only requires a new adapter.
interface IVaultAdapter {
    function vault() external view returns (address);
    function asset() external view returns (address);

    /// @dev Deposits `assets` (already transferred to this adapter by the caller) into the
    /// vault, crediting shares to `onBehalfOf`. Returns shares minted.
    function deposit(uint256 assets, address onBehalfOf) external returns (uint256 shares);

    /// @dev Requests redemption of `shares` (already transferred to this adapter) for
    /// `onBehalfOf`. Returns the vault's own request id.
    function requestRedeem(uint256 shares, address onBehalfOf) external returns (uint256 requestId);

    /// @dev The vault mints a rejected request's shares back to whichever address called its
    /// requestRedeem — that's always this adapter, never the account directly, since accounts
    /// only ever reach the vault through it. Forwards those shares to `redeemRequests(id)`'s
    /// own `receiver` field (the account that actually made the request), recomputed from the
    /// vault's own state, not a caller-supplied claim. Reverts if the request isn't Rejected,
    /// if the caller isn't that request's receiver, or if already recovered once. Returns the
    /// shares forwarded.
    function recoverRejectedShares(uint256 requestId) external returns (uint256 shares);

    function navPerShare() external view returns (uint256);
    function sharesOf(address account) external view returns (uint256);
    function minDepositAssets() external view returns (uint256);
    function minRedeemAssets() external view returns (uint256);
    function previewRedeemAssets(uint256 shares) external view returns (uint256);

    // Deliberately no on-chain codehash()/implementation-slot getter here: Solidity has no
    // opcode to read another contract's storage, so a proxy's implementation slot can only
    // be read off-chain (RPC eth_getStorageAt, as Phase 0 did) or by the vault exposing its
    // own getter (this one doesn't). Codehash/implementation monitoring for
    // VaultHealthFeed.CODEHASH_CHANGED is computed off-chain by the reporter and published
    // as data — see spec/health.md section 1/7.2 and packages/engine/src/health.ts, which
    // already takes codehash as a caller-supplied parameter rather than computing it.
}
