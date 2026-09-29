"""Agreement signing and chain recording adapter for Agent Accord."""

from .adapter import AgreementChain, ChainConfig, ChainError, SubmissionUnknown
from .signing import approval_payload, snapshot_hash, verify_approval_signature

__all__ = [
    "AgreementChain",
    "ChainConfig",
    "ChainError",
    "SubmissionUnknown",
    "approval_payload",
    "snapshot_hash",
    "verify_approval_signature",
]
