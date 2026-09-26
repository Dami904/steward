// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Types} from "./libraries/Types.sol";

/// @notice spec/health.md section 3. Registered reporters publish snapshots; anyone can
/// read. onchain-access-control skill, check 1: publish() default-denies to
/// non-registered reporters.
contract VaultHealthFeed {
    struct HealthSnapshot {
        uint64 fromBlock;
        uint64 toBlock;
        uint40 ts;
        uint8 method; // Types.METHOD_*
        uint16 n;
        uint32 p50Sec;
        uint32 p90Sec;
        uint32 maxSec;
        uint128 navPerShare;
        uint16 drawdownBps;
        bytes32 codehash;
        uint32 flags; // Types.FLAG_*
        bytes32 evidenceHash;
    }

    address public immutable admin;
    mapping(address => bool) public isRegisteredReporter;

    mapping(address => HealthSnapshot) private latest;
    mapping(address => uint64) private latestId;
    uint64 private nextId = 1;

    event ReporterRegistered(address indexed reporter);
    event ReporterRevoked(address indexed reporter);
    event Published(address indexed vault, uint64 indexed id, uint8 method, uint16 n, bytes32 evidenceHash);

    error NotAdmin();
    error NotRegisteredReporter();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        require(admin_ != address(0), "VaultHealthFeed: zero admin");
        admin = admin_;
    }

    function registerReporter(address reporter) external onlyAdmin {
        // forge-lint: disable-next-line(missing-events-access-control) -- ReporterRegistered is emitted below
        isRegisteredReporter[reporter] = true;
        emit ReporterRegistered(reporter);
    }

    function revokeReporter(address reporter) external onlyAdmin {
        // forge-lint: disable-next-line(missing-events-access-control) -- ReporterRevoked is emitted below
        isRegisteredReporter[reporter] = false;
        emit ReporterRevoked(reporter);
    }

    function publish(address vault, HealthSnapshot calldata s) external {
        if (!isRegisteredReporter[msg.sender]) revert NotRegisteredReporter();

        uint64 id = nextId++;
        latest[vault] = s;
        latestId[vault] = id;

        emit Published(vault, id, s.method, s.n, s.evidenceHash);
    }

    function healthOf(address vault) external view returns (HealthSnapshot memory snapshot, uint64 id) {
        return (latest[vault], latestId[vault]);
    }
}
