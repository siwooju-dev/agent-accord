// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Records relayer-attested audit hashes. No payment or buyer/seller wallet signature claim.
contract AuditRegistry {
    address public immutable relayer;
    mapping(bytes32 => bytes32) public records;
    event AuditRecorded(bytes32 indexed recordId, bytes32 auditHash);

    constructor(address authorizedRelayer) {
        require(authorizedRelayer != address(0), "zero relayer");
        relayer = authorizedRelayer;
    }

    function record(bytes32 recordId, bytes32 auditHash) external {
        require(msg.sender == relayer, "unauthorized");
        require(recordId != bytes32(0) && auditHash != bytes32(0), "zero hash");
        require(records[recordId] == bytes32(0), "duplicate record");
        records[recordId] = auditHash;
        emit AuditRecorded(recordId, auditHash);
    }
}
