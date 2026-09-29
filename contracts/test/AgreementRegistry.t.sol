// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AgreementRegistry} from "../src/AgreementRegistry.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8, bytes32, bytes32);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
    function expectRevert() external;
    function expectEmit(bool, bool, bool, bool) external;
}

contract AgreementRegistryTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant AGREEMENT_HASH = keccak256("agreement-1");
    bytes32 private constant TYPEHASH = keccak256(
        "AgreementApproval(bytes32 agreementHash,address buyer,address seller,uint256 totalKrw,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant BUYER_KEY = 0xA11CE;
    uint256 private constant SELLER_KEY = 0xB0B;
    uint256 private constant PRICE = 460000;
    uint256 private constant NONCE = 1;
    uint256 private constant DEADLINE = 1893499200;
    address private constant RELAYER = address(0xC0FFEE);
    AgreementRegistry private registry;
    address private buyer;
    address private seller;

    event AgreementRecorded(
        bytes32 indexed agreementHash,
        address indexed buyer,
        address indexed seller,
        uint256 totalKrw,
        uint256 nonce,
        uint256 recordedAt
    );

    function setUp() public {
        vm.warp(1893412800);
        vm.chainId(84532);
        buyer = vm.addr(BUYER_KEY);
        seller = vm.addr(SELLER_KEY);
        registry = new AgreementRegistry(RELAYER);
    }

    function _digest(address target, uint256 chainId, bytes32 agreementHash, uint256 price)
        private
        view
        returns (bytes32)
    {
        bytes32 domain =
            keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("AgentAccord"), keccak256("1"), chainId, target));
        bytes32 structHash = keccak256(abi.encode(TYPEHASH, agreementHash, buyer, seller, price, NONCE, DEADLINE));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _signature(uint256 key, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _record(bytes32 agreementHash, uint256 price, bytes memory buyerSignature, bytes memory sellerSignature)
        private
    {
        vm.prank(RELAYER);
        registry.recordAgreement(agreementHash, buyer, seller, price, NONCE, DEADLINE, buyerSignature, sellerSignature);
    }

    function testRecordsTwoSignaturesAndEmitsEvent() public {
        bytes32 digest = _digest(address(registry), block.chainid, AGREEMENT_HASH, PRICE);
        vm.expectEmit(true, true, true, true);
        emit AgreementRecorded(AGREEMENT_HASH, buyer, seller, PRICE, NONCE, block.timestamp);
        _record(AGREEMENT_HASH, PRICE, _signature(BUYER_KEY, digest), _signature(SELLER_KEY, digest));
        (bool exists, address storedBuyer, address storedSeller, uint256 total, uint256 nonce, uint256 recordedAt) =
            registry.getAgreement(AGREEMENT_HASH);
        require(exists && storedBuyer == buyer && storedSeller == seller, "parties");
        require(total == PRICE && nonce == NONCE && recordedAt == block.timestamp, "agreement");
    }

    function testRejectsUnauthorizedRelayer() public {
        bytes32 digest = _digest(address(registry), block.chainid, AGREEMENT_HASH, PRICE);
        vm.expectRevert();
        registry.recordAgreement(
            AGREEMENT_HASH,
            buyer,
            seller,
            PRICE,
            NONCE,
            DEADLINE,
            _signature(BUYER_KEY, digest),
            _signature(SELLER_KEY, digest)
        );
    }

    function testRejectsBuyerAndSellerMismatch() public {
        bytes32 digest = _digest(address(registry), block.chainid, AGREEMENT_HASH, PRICE);
        vm.expectRevert();
        _record(AGREEMENT_HASH, PRICE, _signature(SELLER_KEY, digest), _signature(SELLER_KEY, digest));
        vm.expectRevert();
        _record(AGREEMENT_HASH, PRICE, _signature(BUYER_KEY, digest), _signature(BUYER_KEY, digest));
    }

    function testRejectsChangedPriceOrHash() public {
        bytes32 digest = _digest(address(registry), block.chainid, AGREEMENT_HASH, PRICE);
        bytes memory buyerSig = _signature(BUYER_KEY, digest);
        bytes memory sellerSig = _signature(SELLER_KEY, digest);
        vm.expectRevert();
        _record(AGREEMENT_HASH, PRICE + 1, buyerSig, sellerSig);
        vm.expectRevert();
        _record(keccak256("changed"), PRICE, buyerSig, sellerSig);
    }

    function testRejectsWrongChainOrContract() public {
        bytes32 chainDigest = _digest(address(registry), 1, AGREEMENT_HASH, PRICE);
        vm.expectRevert();
        _record(AGREEMENT_HASH, PRICE, _signature(BUYER_KEY, chainDigest), _signature(SELLER_KEY, chainDigest));
        bytes32 contractDigest = _digest(address(0x1234), block.chainid, AGREEMENT_HASH, PRICE);
        vm.expectRevert();
        _record(AGREEMENT_HASH, PRICE, _signature(BUYER_KEY, contractDigest), _signature(SELLER_KEY, contractDigest));
    }

    function testRejectsExpired() public {
        vm.warp(DEADLINE + 1);
        bytes32 digest = _digest(address(registry), block.chainid, AGREEMENT_HASH, PRICE);
        vm.expectRevert();
        _record(AGREEMENT_HASH, PRICE, _signature(BUYER_KEY, digest), _signature(SELLER_KEY, digest));
    }

    function testRejectsDuplicateHashAndBuyerNonce() public {
        bytes32 digest = _digest(address(registry), block.chainid, AGREEMENT_HASH, PRICE);
        bytes memory buyerSig = _signature(BUYER_KEY, digest);
        bytes memory sellerSig = _signature(SELLER_KEY, digest);
        _record(AGREEMENT_HASH, PRICE, buyerSig, sellerSig);
        vm.expectRevert();
        _record(AGREEMENT_HASH, PRICE, buyerSig, sellerSig);
        bytes32 secondHash = keccak256("agreement-2");
        bytes32 secondDigest = _digest(address(registry), block.chainid, secondHash, PRICE);
        vm.expectRevert();
        _record(secondHash, PRICE, _signature(BUYER_KEY, secondDigest), _signature(SELLER_KEY, secondDigest));
    }

    function testRejectsEmptyAgreementValues() public {
        bytes32 digest = _digest(address(registry), block.chainid, AGREEMENT_HASH, PRICE);
        vm.expectRevert();
        _record(bytes32(0), PRICE, _signature(BUYER_KEY, digest), _signature(SELLER_KEY, digest));
        vm.expectRevert();
        _record(AGREEMENT_HASH, 0, _signature(BUYER_KEY, digest), _signature(SELLER_KEY, digest));
    }

    function testRejectsSameBuyerAndSeller() public {
        bytes32 digest = _digest(address(registry), block.chainid, AGREEMENT_HASH, PRICE);
        vm.expectRevert();
        vm.prank(RELAYER);
        registry.recordAgreement(
            AGREEMENT_HASH,
            buyer,
            buyer,
            PRICE,
            NONCE,
            DEADLINE,
            _signature(BUYER_KEY, digest),
            _signature(BUYER_KEY, digest)
        );
    }

    function testUnrecordedHashReturnsExistsFalse() public view {
        (bool exists,,,,,) = registry.getAgreement(keccak256("unknown"));
        require(!exists, "unexpected record");
    }

    function testPythonTypedDataGoldenDigest() public pure {
        bytes32 domain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("AgentAccord"),
                keccak256("1"),
                uint256(84532),
                address(0x3333333333333333333333333333333333333333)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                TYPEHASH,
                bytes32(0x10c8bc9492fea93859ecb238acd53f1b86c4c34895187be9116f35811e5556cc),
                address(0x1111111111111111111111111111111111111111),
                address(0x2222222222222222222222222222222222222222),
                uint256(460000),
                uint256(1),
                uint256(1893499200)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        require(digest == 0x20517f730396299e6b81037818241ee1c2c442406b3d77c047821c8d3aa3554b, "digest mismatch");
    }
}
