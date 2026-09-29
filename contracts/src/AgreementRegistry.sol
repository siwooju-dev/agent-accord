// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Records that two EOA wallets signed the same agreement hash.
/// @dev The underlying agreement and its evidence remain off-chain. No payment occurs here.
contract AgreementRegistry is EIP712 {
    bytes32 private constant APPROVAL_TYPEHASH = keccak256(
        "AgreementApproval(bytes32 agreementHash,address buyer,address seller,uint256 totalKrw,uint256 nonce,uint256 deadline)"
    );

    struct Agreement {
        bool exists;
        address buyer;
        address seller;
        uint256 totalKrw;
        uint256 nonce;
        uint256 recordedAt;
    }

    address public immutable relayer;
    mapping(bytes32 => Agreement) private agreements;
    mapping(address => mapping(uint256 => bool)) private usedBuyerNonces;

    event AgreementRecorded(
        bytes32 indexed agreementHash,
        address indexed buyer,
        address indexed seller,
        uint256 totalKrw,
        uint256 nonce,
        uint256 recordedAt
    );

    error Unauthorized();
    error InvalidAgreement();
    error Expired();
    error AgreementAlreadyRecorded();
    error BuyerNonceAlreadyUsed();
    error InvalidBuyerSignature();
    error InvalidSellerSignature();

    constructor(address authorizedRelayer) EIP712("AgentAccord", "1") {
        if (authorizedRelayer == address(0)) revert InvalidAgreement();
        relayer = authorizedRelayer;
    }

    function recordAgreement(
        bytes32 agreementHash,
        address buyer,
        address seller,
        uint256 totalKrw,
        uint256 nonce,
        uint256 deadline,
        bytes calldata buyerSignature,
        bytes calldata sellerSignature
    ) external {
        if (msg.sender != relayer) revert Unauthorized();
        if (
            agreementHash == bytes32(0) || buyer == address(0) || seller == address(0) || buyer == seller
                || totalKrw == 0 || nonce == 0
        ) revert InvalidAgreement();
        if (block.timestamp > deadline) revert Expired();
        if (agreements[agreementHash].exists) revert AgreementAlreadyRecorded();
        if (usedBuyerNonces[buyer][nonce]) revert BuyerNonceAlreadyUsed();

        bytes32 structHash =
            keccak256(abi.encode(APPROVAL_TYPEHASH, agreementHash, buyer, seller, totalKrw, nonce, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (ECDSA.recover(digest, buyerSignature) != buyer) revert InvalidBuyerSignature();
        if (ECDSA.recover(digest, sellerSignature) != seller) revert InvalidSellerSignature();

        usedBuyerNonces[buyer][nonce] = true;
        agreements[agreementHash] = Agreement(true, buyer, seller, totalKrw, nonce, block.timestamp);
        emit AgreementRecorded(agreementHash, buyer, seller, totalKrw, nonce, block.timestamp);
    }

    function getAgreement(bytes32 agreementHash)
        external
        view
        returns (bool exists, address buyer, address seller, uint256 totalKrw, uint256 nonce, uint256 recordedAt)
    {
        Agreement storage agreement = agreements[agreementHash];
        return (
            agreement.exists,
            agreement.buyer,
            agreement.seller,
            agreement.totalKrw,
            agreement.nonce,
            agreement.recordedAt
        );
    }
}
