// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* ========== Minimal USDC-3009 interface ========== */
interface IUSDC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external;
}

/* ========== Reentrancy Guard ========== */
abstract contract ReentrancyGuard {
    uint256 private _status = 1;
    modifier nonReentrant() {
        require(_status == 1, "REENTRANCY");
        _status = 2;
        _;
        _status = 1;
    }
}

/**
 * @title X402 Atomic Orchestrator (user -> server; server -> feeReceiver; optional callback)
 * @notice
 *  - Enforces strong atomicity across three steps in a single tx:
 *      (1) USDC transferWithAuthorization: user -> server (A)
 *      (2) USDC transferWithAuthorization: server -> feeReceiver (B), where
 *          B.value MUST equal floor(A.value * feeBps / 10000) and B.to MUST equal feeReceiver
 *      (3) Optional on-chain callback (target.call(callback))
 *    If any step fails, the whole tx reverts and both authorizations remain unconsumed.
 *  - Fee receiver and fee rate (feeBps) are configured on-contract.
 *  - No intent-hash / no per-tx fee caps. Simpler threat model: facilitator cannot steal user funds
 *    since A.to is server; facilitator can only be paid if both A and callback succeed and B matches policy.
 */
contract X402AtomicServerTo is ReentrancyGuard {
    /* ---------- Immutable config ---------- */
    address public immutable USDC;       // USDC token (3009-enabled)
    address public owner;

    /* ---------- Fee policy (fixed on contract) ---------- */
    address public feeReceiver;          // where server's fee must be paid to
    uint256 public feeBps;               // e.g., 30 = 0.3%

    /* ---------- Events ---------- */
    event OwnerChanged(address indexed newOwner);
    event FeeConfigUpdated(address indexed feeReceiver, uint256 feeBps);
    event TargetWhitelisted(address indexed target, bool allowed);
    event Settled(
        address indexed user,
        address indexed server,
        address indexed feeReceiver,
        uint256 userPay,
        uint256 feePaid
    );

    /* ---------- Types ---------- */
    struct PayAuth {
        address from;          // signer / source
        address to;            // recipient
        uint256 value;         // amount
        uint256 validAfter;    // 3009 timing
        uint256 validBefore;   // 3009 timing
        bytes32 nonce;         // 3009 unique nonce
        uint8 v; bytes32 r; bytes32 s; // ECDSA sig
    }

    /* ---------- Constructor ---------- */
    constructor(
        address usdc,
        address _feeReceiver,
        uint256 _feeBps
    ) {
        require(usdc != address(0), "USDC_ZERO");
        require(_feeReceiver != address(0), "FEE_RCV_ZERO");
        USDC = usdc;
        owner = msg.sender;
        feeReceiver = _feeReceiver;
        feeBps = _feeBps;
        emit OwnerChanged(msg.sender);
        emit FeeConfigUpdated(_feeReceiver, _feeBps);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    /* ---------- Admin ---------- */

    /// @notice Transfer contract ownership.
    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "OWNER_ZERO");
        owner = newOwner;
        emit OwnerChanged(newOwner);
    }

    /// @notice Update fee receiver and fee bps (global, fixed policy).
    function setFeeConfig(address _feeReceiver, uint256 _feeBps) external onlyOwner {
        require(_feeReceiver != address(0), "FEE_RCV_ZERO");
        // no explicit cap here by your requirement; set responsibly off-chain
        feeReceiver = _feeReceiver;
        feeBps = _feeBps;
        emit FeeConfigUpdated(_feeReceiver, _feeBps);
    }

    /* ---------- Core: atomic settlement ---------- */
    /**
     * @dev Performs in-order:
     *  A) user -> server  via transferWithAuthorization (author A)
     *  B) server -> feeReceiver via transferWithAuthorization (author B), with strict checks:
     *     - B.from MUST equal A.to (server pays the fee)
     *     - B.to   MUST equal feeReceiver
     *     - B.value MUST equal floor(A.value * feeBps / 10000)
     *  C) Optional callback; if it reverts, entire tx reverts (A and B revert too).
     *
     * @param userPay  authorization A (user -> server)
     * @param feePay   authorization B (server -> feeReceiver)
     * @param target   optional callback target (set zero address to skip)
     * @param callback optional callback calldata
     */
    function settleUserToServerWithFixedFeeAndCallback(
        PayAuth calldata userPay,
        PayAuth calldata feePay,
        address target,
        bytes calldata callback
    ) external nonReentrant {
        // Basic sanity checks
        require(userPay.from != address(0) && userPay.to != address(0), "BAD_A");
        require(feePay.from  != address(0) && feePay.to  != address(0), "BAD_B");
        require(userPay.value > 0, "A_VALUE_ZERO");

        // Strict fee policy
        // - server is A.to
        // - fee must go to feeReceiver
        // - fee amount equals floor(A.value * feeBps / 10000)
        require(feePay.to   == feeReceiver, "B_TO_NOT_FEE_RCV");

        uint256 expectedFee = (userPay.value * feeBps) / 10000;
        require(feePay.value == expectedFee, "B_VALUE_MISMATCH");

        IUSDC3009 usdc = IUSDC3009(USDC);

        // A) user -> server
        usdc.transferWithAuthorization(
            userPay.from, userPay.to, userPay.value,
            userPay.validAfter, userPay.validBefore, userPay.nonce,
            userPay.v, userPay.r, userPay.s
        );

        // B) server -> feeReceiver
        if (expectedFee > 0) {
            usdc.transferWithAuthorization(
                feePay.from, feePay.to, feePay.value,
                feePay.validAfter, feePay.validBefore, feePay.nonce,
                feePay.v, feePay.r, feePay.s
            );
        }

        // C) Optional callback (strong atomicity: if callback fails, revert all)
        if (target != address(0)) {
            (bool ok, bytes memory res) = target.call(callback);
            if (!ok) _bubble(res);
        }

        emit Settled(userPay.from, userPay.to, feeReceiver, userPay.value, expectedFee);
    }

    /* ---------- Helpers ---------- */
    function _bubble(bytes memory res) private pure {
        if (res.length == 0) revert("CALLBACK_FAIL");
        assembly { revert(add(res, 0x20), mload(res)) }
    }

    // Accept native if ever needed (not used in core flow)
    receive() external payable {}
}