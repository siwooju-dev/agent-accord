PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS buyer_intents (
    id TEXT PRIMARY KEY,
    buyer_id TEXT NOT NULL,
    gpu_model TEXT NOT NULL,
    max_total_krw INTEGER NOT NULL CHECK (max_total_krw > 0),
    delivery_deadline TEXT NOT NULL,
    must_have_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(must_have_json)),
    scenario TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    seller_id TEXT NOT NULL,
    gpu_model TEXT NOT NULL,
    asking_price_krw INTEGER NOT NULL CHECK (asking_price_krw > 0),
    shipping_fee_krw INTEGER NOT NULL CHECK (shipping_fee_krw >= 0),
    condition_text TEXT NOT NULL,
    warranty_end TEXT,
    stock_status TEXT NOT NULL CHECK (stock_status IN ('available', 'sold')),
    stock_quantity INTEGER NOT NULL DEFAULT 1 CHECK (stock_quantity >= 0),
    data_label TEXT,
    description_version INTEGER NOT NULL DEFAULT 1 CHECK (description_version > 0),
    description_updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_description_history (
    listing_id TEXT NOT NULL REFERENCES listings(id),
    version INTEGER NOT NULL CHECK (version > 0),
    condition_text TEXT NOT NULL,
    warranty_end TEXT,
    changed_at TEXT NOT NULL,
    PRIMARY KEY (listing_id, version)
);

CREATE TABLE IF NOT EXISTS seller_policies (
    id TEXT PRIMARY KEY,
    seller_id TEXT NOT NULL,
    listing_id TEXT NOT NULL UNIQUE REFERENCES listings(id),
    min_item_price_krw INTEGER NOT NULL CHECK (min_item_price_krw > 0),
    earliest_delivery_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidences (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    ref TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 66 AND substr(sha256, 1, 2) = '0x'),
    content_text TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    uploaded_by TEXT,
    uploaded_at TEXT NOT NULL,
    verification_status TEXT NOT NULL CHECK (verification_status IN ('seller_claimed', 'checked', 'conflicted', 'unknown')),
    verification_method TEXT,
    verified_by TEXT,
    note TEXT
);

CREATE TABLE IF NOT EXISTS listing_evidence (
    listing_id TEXT NOT NULL REFERENCES listings(id),
    evidence_id TEXT NOT NULL UNIQUE REFERENCES evidences(id),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (listing_id, evidence_id),
    UNIQUE (listing_id, position)
);

CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY,
    buyer_intent_id TEXT NOT NULL REFERENCES buyer_intents(id),
    negotiation_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_assessments (
    flow_id TEXT NOT NULL REFERENCES flows(id),
    listing_id TEXT NOT NULL REFERENCES listings(id),
    summary TEXT NOT NULL,
    findings_json TEXT NOT NULL CHECK (json_valid(findings_json)),
    source TEXT NOT NULL CHECK (source IN ('kiln', 'mock')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (flow_id, listing_id)
);

CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL REFERENCES flows(id),
    negotiation_id TEXT NOT NULL,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    round INTEGER NOT NULL CHECK (round >= 0),
    proposer TEXT NOT NULL CHECK (proposer IN ('buyer', 'seller')),
    item_price_krw INTEGER NOT NULL CHECK (item_price_krw > 0),
    shipping_fee_krw INTEGER NOT NULL CHECK (shipping_fee_krw >= 0),
    total_krw INTEGER NOT NULL CHECK (total_krw = item_price_krw + shipping_fee_krw),
    delivery_by TEXT NOT NULL,
    warranty_terms TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL CHECK (json_valid(evidence_ids_json)),
    rationale TEXT NOT NULL,
    valid INTEGER NOT NULL DEFAULT 0 CHECK (valid IN (0, 1)),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agreements (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL REFERENCES flows(id),
    offer_id TEXT NOT NULL UNIQUE REFERENCES offers(id),
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    snapshot_hash TEXT NOT NULL UNIQUE CHECK (length(snapshot_hash) = 66 AND substr(snapshot_hash, 1, 2) = '0x'),
    buyer_wallet TEXT NOT NULL,
    seller_wallet TEXT NOT NULL,
    nonce INTEGER NOT NULL CHECK (nonce > 0),
    buyer_signature TEXT,
    seller_signature TEXT,
    buyer_approved INTEGER NOT NULL DEFAULT 0 CHECK (buyer_approved IN (0, 1)),
    seller_approved INTEGER NOT NULL DEFAULT 0 CHECK (seller_approved IN (0, 1)),
    status TEXT NOT NULL,
    tx_hash TEXT,
    receipt_json TEXT CHECK (receipt_json IS NULL OR json_valid(receipt_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (buyer_wallet, nonce)
);

CREATE TRIGGER IF NOT EXISTS agreements_immutable_snapshot
BEFORE UPDATE OF snapshot_json, snapshot_hash, buyer_wallet, seller_wallet, nonce, offer_id ON agreements
BEGIN
    SELECT RAISE(ABORT, 'agreement snapshot is immutable');
END;

CREATE TRIGGER IF NOT EXISTS agreements_preserve_recorded
BEFORE DELETE ON agreements WHEN OLD.status = 'RECORDED'
BEGIN
    SELECT RAISE(ABORT, 'recorded agreement must be preserved');
END;

CREATE TRIGGER IF NOT EXISTS agreements_freeze_recorded
BEFORE UPDATE ON agreements WHEN OLD.status = 'RECORDED'
BEGIN
    SELECT RAISE(ABORT, 'recorded agreement must be preserved');
END;

CREATE TABLE IF NOT EXISTS audit_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    flow_id TEXT NOT NULL REFERENCES flows(id),
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    event_type TEXT NOT NULL,
    object_id TEXT,
    decision TEXT,
    reason_code TEXT,
    details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json))
);

CREATE TABLE IF NOT EXISTS model_usage (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    flow_id TEXT NOT NULL REFERENCES flows(id),
    actor TEXT NOT NULL,
    step TEXT NOT NULL,
    model_id TEXT NOT NULL,
    request_id TEXT,
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
    source TEXT NOT NULL CHECK (source IN ('api', 'estimated')),
    at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_runs (
    dataset_id TEXT PRIMARY KEY,
    source_reference_time TEXT NOT NULL,
    shifted_days INTEGER NOT NULL CHECK (shifted_days >= 0),
    seeded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_scenarios (
    intent_id TEXT PRIMARY KEY REFERENCES buyer_intents(id),
    expected_candidate_ids_json TEXT NOT NULL CHECK (json_valid(expected_candidate_ids_json)),
    expected_budget_ids_json TEXT NOT NULL CHECK (json_valid(expected_budget_ids_json)),
    notes TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS listings_search_idx ON listings(gpu_model, stock_status, stock_quantity);
CREATE INDEX IF NOT EXISTS seller_policies_delivery_idx ON seller_policies(earliest_delivery_at);
CREATE INDEX IF NOT EXISTS offers_flow_idx ON offers(flow_id, created_at);
CREATE INDEX IF NOT EXISTS audit_events_flow_idx ON audit_events(flow_id, at, sequence);
CREATE INDEX IF NOT EXISTS model_usage_flow_idx ON model_usage(flow_id, at, sequence);
