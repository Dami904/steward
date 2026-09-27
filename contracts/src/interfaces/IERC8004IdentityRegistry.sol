// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal interface for ERC-8004's real, deployed IdentityRegistry on BSC mainnet
/// (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`), reconstructed from its actual verified
/// source (github.com/erc-8004/erc-8004-contracts, `IdentityRegistryUpgradeable.sol`) —
/// confirmed 2026-09-23, both the address (real deployed bytecode, read directly via
/// `cast code` against BSC mainnet, not assumed) and this function surface (read from the
/// real source, not the spec prose alone).
///
/// Only the subset this repo actually calls: `register(string)` (one of three real overloads
/// — the no-URI and metadata-array variants exist on the real contract too but aren't needed
/// here) and the read-only helpers used to verify registration succeeded.
interface IERC8004IdentityRegistry {
    /// @dev The real contract's caller (msg.sender) becomes the newly minted agent's owner —
    /// there is no separate "on behalf of" parameter. Returns the new agentId.
    function register(string calldata agentURI) external returns (uint256 agentId);

    function setAgentURI(uint256 agentId, string calldata agentURI) external;

    function ownerOf(uint256 agentId) external view returns (address);

    function tokenURI(uint256 agentId) external view returns (string memory);
}
