-- AI Review Telemetry for quality tracking and sommelier feedback loop
CREATE TABLE IF NOT EXISTS ai_review_telemetry (
    id BIGSERIAL PRIMARY KEY,

    -- Linkability
    cellar_id TEXT,
    plan_id TEXT NOT NULL,
    session_id TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    review_started_at TIMESTAMPTZ,
    review_completed_at TIMESTAMPTZ,

    -- Input context
    input_plan_hash TEXT,
    planner_model TEXT,
    input_action_count INTEGER,
    input_summary JSONB,

    -- Reviewer details
    reviewer_model TEXT NOT NULL,
    reasoning_effort TEXT,
    temperature REAL,
    max_output_tokens INTEGER,

    -- Output
    verdict TEXT NOT NULL,
    violations_count INTEGER DEFAULT 0,
    patches_count INTEGER DEFAULT 0,
    output_plan_hash TEXT,
    output_action_count INTEGER,

    -- Detailed results
    violations JSONB,
    patches JSONB,
    reviewer_reasoning TEXT,

    -- Token usage
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    reasoning_tokens INTEGER,

    -- Performance
    latency_ms INTEGER,

    -- Quality metrics
    stability_score REAL,
    constraint_violations_found INTEGER,

    -- Circuit breaker
    was_fallback BOOLEAN DEFAULT FALSE,
    fallback_reason TEXT,

    -- Sommelier feedback
    sommelier_rating INTEGER,
    sommelier_notes TEXT,
    reviewed_by_sommelier_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_review_telemetry_plan_id
    ON ai_review_telemetry (plan_id);
CREATE INDEX IF NOT EXISTS idx_ai_review_telemetry_created_at
    ON ai_review_telemetry (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_review_telemetry_verdict
    ON ai_review_telemetry (verdict);
CREATE INDEX IF NOT EXISTS idx_ai_review_telemetry_sommelier_pending
    ON ai_review_telemetry (created_at DESC)
    WHERE sommelier_rating IS NULL;
