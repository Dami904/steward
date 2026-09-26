// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC8004IdentityRegistry} from "../interfaces/IERC8004IdentityRegistry.sol";
import {StewardAccount} from "../StewardAccount.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @notice Registers a StewardAccount as a real ERC-8004 "Trustless Agent" identity — one
/// bridge instance per account, immutably bound to it at construction, owner-gated. Zero
/// ripple into StewardAccount.sol itself: this only ever reads its public `owner()` getter,
/// never writes to it or is written to by it.
///
/// spec/DECISIONS.md "Phase 6, fifth item": the plan's original design for this Phase 6 item
/// was "ERC-8004 bridge (owner-posted feedback from tier events)" — that specific mechanism
/// is impossible against the real, deployed ReputationRegistry, which explicitly reverts
/// ("Self-feedback not allowed") if the feedback-giver is the agent's own owner
/// (`isAuthorizedOrOwner`). This contract does the part that IS real and buildable: identity
/// registration. `scripts/generate-erc8004-feedback.ts` covers the adapted part: generating a
/// spec-compliant feedback payload an independent THIRD PARTY (never this account's own
/// owner) could post about this account's real on-chain conduct.
///
/// Deliberately holds the identity NFT itself, not the StewardAccount's owner directly:
/// `IERC8004IdentityRegistry.register`'s real contract makes `msg.sender` the new agentId's
/// owner with no "on behalf of" parameter, so if the StewardAccount's owner called it
/// directly, the identity would end up controlled by a plain EOA/multisig with no on-chain
/// link back to which StewardAccount it represents. Routing through this immutable,
/// one-per-account bridge keeps that link permanent and on-chain (`account` is immutable),
/// while `onlyAccountOwner` still gives the StewardAccount's real owner exclusive control
/// over the registration/URI-update actions themselves.
contract ERC8004IdentityBridge is IERC721Receiver {
    IERC8004IdentityRegistry public immutable identityRegistry;
    StewardAccount public immutable account;

    uint256 public agentId;
    bool public registered;

    error AlreadyRegistered();
    error NotRegisteredYet();
    error NotAccountOwner();

    event AgentRegistered(uint256 indexed agentId, string agentURI);
    event AgentURIUpdated(string agentURI);

    modifier onlyAccountOwner() {
        if (msg.sender != account.owner()) revert NotAccountOwner();
        _;
    }

    constructor(address identityRegistry_, address account_) {
        identityRegistry = IERC8004IdentityRegistry(identityRegistry_);
        account = StewardAccount(account_);
    }

    /// @dev One-time only — a StewardAccount gets exactly one ERC-8004 identity for its
    /// lifetime, matching the real registry's own one-owner-per-agentId model (re-registering
    /// would just mint an unrelated second NFT, not "update" anything).
    function register(string calldata agentURI) external onlyAccountOwner returns (uint256) {
        if (registered) revert AlreadyRegistered();
        registered = true;
        agentId = identityRegistry.register(agentURI);
        emit AgentRegistered(agentId, agentURI);
        return agentId;
    }

    function updateAgentURI(string calldata agentURI) external onlyAccountOwner {
        if (!registered) revert NotRegisteredYet();
        identityRegistry.setAgentURI(agentId, agentURI);
        emit AgentURIUpdated(agentURI);
    }

    /// @dev Required for `register()` above to succeed at all: the real IdentityRegistry
    /// mints via OpenZeppelin's `_safeMint`, which calls this on any receiving contract and
    /// reverts the whole mint (`ERC721InvalidReceiver`) if it doesn't return this exact
    /// selector — confirmed the hard way, by first running the fork test in
    /// test/fork/ERC8004Identity.t.sol against the real registry without this function and
    /// watching every registration attempt revert. No access control needed: this is a pure
    /// acceptance signal with no state effect, and the real registry is the only caller that
    /// matters (an arbitrary caller invoking it directly accomplishes nothing).
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
