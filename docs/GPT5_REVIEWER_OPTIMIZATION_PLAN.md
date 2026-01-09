# GPT-5.2 Reviewer Optimization Plan

Based on feedback analysis, this plan addresses 7 key issues to reduce latency from ~54s to <10s and improve reliability.

---

## Summary of Changes

| Issue | Current State | Target State | Impact |
|-------|--------------|--------------|--------|
| SDK usage | `responses.create()` + manual JSON.parse | `responses.parse()` + `zodTextFormat()` | Eliminates parse failures |
| Output reading | Fragile `output[0].content[0].text` | Use `output_parsed` from parse() | Reliable output extraction |
| Latency | ~54s with 16k tokens, medium reasoning | <10s with 2k tokens, no reasoning | 5-10x faster |
| Schema size | Returns violations + patches (compact) | Already good, add bounds | Prevent runaway |
| Model selection | Always gpt-5.2 | gpt-5-mini default, escalate if needed | Cost/speed reduction |
| Temperature | Conditionally omit for gpt-5.x | Remove entirely for reviewer | Simpler, deterministic |
| Verbosity | Not set | `text.verbosity: "low"` | Reduces tokens |

---

## Phase 1: SDK Upgrade (Use `responses.parse()`)

**File:** `src/services/openaiReviewer.js`

### 1.1 Import `zodTextFormat`

```javascript
// OLD
import { zodResponseFormat } from 'openai/helpers/zod';

// NEW
import { zodTextFormat } from 'openai/helpers/zod';
```

### 1.2 Use `responses.parse()` instead of `responses.create()`

```javascript
// OLD
const schemaFormat = zodResponseFormat(ReviewResultSchema, 'review_result');
const requestParams = {
  model: modelId,
  input: [...],
  text: {
    format: {
      type: 'json_schema',
      name: schemaFormat.json_schema.name,
      strict: schemaFormat.json_schema.strict,
      schema: schemaFormat.json_schema.schema
    }
  },
  max_output_tokens: config.max_output_tokens
};
response = await openai.responses.create(requestParams);
const outputText = response.output_text || response.output?.[0]?.content?.[0]?.text || '';
const result = ReviewResultSchema.parse(JSON.parse(outputText));

// NEW
const requestParams = {
  model: modelId,
  input: [...],
  text: {
    format: zodTextFormat(ReviewResultSchema, 'review_result'),
    verbosity: 'low'  // NEW: reduce token usage
  },
  max_output_tokens: config.max_output_tokens
};
response = await openai.responses.parse(requestParams);
const result = response.output_parsed;  // Already validated by SDK
```

### 1.3 Benefits
- Eliminates manual JSON parsing errors
- Handles whitespace, partial JSON, model warnings automatically
- `output_parsed` is the SDK's reliable aggregation point

---

## Phase 2: Latency Optimization

### 2.1 Keep Medium Reasoning Effort

```javascript
// KEEP: medium reasoning is essential for complex wine layouts
reasoning_effort: options.reasoningEffort || 'medium'
```

**Rationale:** Zone reconfiguration involves complex spatial reasoning about wine layouts. Medium reasoning catches subtle issues like row ownership violations and zone conflicts. The latency improvement comes primarily from other optimizations (SDK usage, reduced tokens, verbosity).

### 2.2 Add Verbosity Setting

```javascript
text: {
  format: zodTextFormat(ReviewResultSchema, 'review_result'),
  verbosity: 'low'  // Reduces output tokens
}
```

### 2.3 Reduce Max Output Tokens

```javascript
// OLD
const defaultMaxOutputTokens = 8000;
config.max_output_tokens = Math.max(options.maxOutputTokens ?? defaultMaxOutputTokens, 4000);

// NEW
const defaultMaxOutputTokens = 1500;  // Review results are small
const minOutputTokens = 800;
const maxOutputTokens = 2000;  // Hard cap
config.max_output_tokens = Math.min(
  Math.max(options.maxOutputTokens ?? defaultMaxOutputTokens, minOutputTokens),
  maxOutputTokens
);
```

**Rationale:** The current schema (violations + patches) rarely exceeds 500 tokens. 2k is generous.

### 2.4 Remove Temperature Entirely

```javascript
// OLD
if (!modelId.startsWith('gpt-5')) {
  requestParams.temperature = config.temperature;
}

// NEW
// No temperature at all - reviewer should be deterministic
// Schema + structured output provides control
```

---

## Phase 3: Schema Hardening

### 3.1 Add Array Bounds

```javascript
// OLD
const ReviewResultSchema = z.object({
  verdict: z.enum(['approve', 'patch', 'reject']),
  violations: z.array(ViolationSchema),
  patches: z.array(PatchSchema),
  reasoning: z.string(),
  stability_score: z.number().min(0).max(1),
  confidence: z.enum(['high', 'medium', 'low'])
});

// NEW
const ReviewResultSchema = z.object({
  verdict: z.enum(['approve', 'patch', 'reject']),
  violations: z.array(ViolationSchema).max(20),  // Cap at 20
  patches: z.array(PatchSchema).max(20),          // Cap at 20
  reasoning: z.string().max(500),                 // Cap length
  stability_score: z.number().min(0).max(1),
  confidence: z.enum(['high', 'medium', 'low'])
});
```

### 3.2 Tighten ViolationSchema

```javascript
const ViolationSchema = z.object({
  action_id: z.number().int().min(0),  // Add int() constraint
  rule: z.string().max(100),           // Cap length
  severity: z.enum(['critical', 'warning']),
  description: z.string().max(200)     // Cap length
});
```

### 3.3 Tighten PatchSchema

```javascript
const PatchSchema = z.object({
  action_id: z.number().int().min(0),
  field: z.string().max(50),
  old_value: z.union([z.string().max(100), z.number(), z.null()]),
  new_value: z.union([z.string().max(100), z.number()]),
  reason: z.string().max(200)
});
```

---

## Phase 4: Model Selection Strategy

### 4.1 Add gpt-5-mini as Default

```javascript
// OLD
const FALLBACK_MODELS = ['gpt-5.2', 'gpt-4.1', 'gpt-4o'];
const preferredModel = options.model || process.env.OPENAI_REVIEW_MODEL || 'gpt-5.2';

// NEW
const FALLBACK_MODELS = ['gpt-5-mini', 'gpt-5.2', 'gpt-4.1', 'gpt-4o'];
const preferredModel = options.model || process.env.OPENAI_REVIEW_MODEL || 'gpt-5-mini';
```

**Rationale:** `gpt-5-mini` is faster and cheaper for verification tasks. Escalate to full gpt-5.2 only for complex plans or when mini fails.

### 4.2 Escalation Logic (Optional Enhancement)

```javascript
// Escalate to full model for complex plans
const planComplexity = (plan.actions?.length || 0) > 10 ? 'high' : 'normal';
const defaultModel = planComplexity === 'high' ? 'gpt-5.2' : 'gpt-5-mini';
```

---

## Phase 5: Handle Incomplete Responses

### 5.1 Treat Incomplete as Failure

```javascript
// After getting response
if (response.status === 'incomplete') {
  const reason = response.incomplete_details?.reason || 'unknown';
  console.warn(`[OpenAIReviewer] Incomplete response: ${reason}`);

  // Don't increase tokens - treat as fallback scenario
  throw new Error(`Reviewer response incomplete: ${reason}`);
}
```

**Rationale:** If the model can't complete within 2k tokens, something is wrong. Fall back rather than retry with more tokens.

---

## Phase 6: Update CLAUDE.md Documentation

Add a new section documenting the Responses API patterns:

```markdown
### OpenAI Responses API with Structured Outputs

Use `responses.parse()` with `zodTextFormat()` for type-safe structured outputs:

\`\`\`javascript
import { zodTextFormat } from 'openai/helpers/zod';

const response = await openai.responses.parse({
  model: 'gpt-5.2',
  input: [...],
  text: {
    format: zodTextFormat(MySchema, 'result_name'),
    verbosity: 'low'
  },
  max_output_tokens: 1500,
  reasoning: { effort: 'medium' }  // Use medium for complex spatial reasoning
});

const result = response.output_parsed;  // Already validated
\`\`\`
```

---

## Implementation Order

1. **Phase 1** - SDK upgrade (breaking change, test thoroughly)
2. **Phase 2** - Latency optimization (tune defaults)
3. **Phase 3** - Schema hardening (non-breaking)
4. **Phase 4** - Model selection (easy toggle)
5. **Phase 5** - Incomplete handling (defensive)
6. **Phase 6** - Documentation (maintenance)

---

## Testing Checklist

- [ ] Unit test: `responses.parse()` returns `output_parsed` correctly
- [ ] Unit test: Schema bounds reject oversized arrays
- [ ] Integration test: Reviewer completes in <10s with `gpt-5-mini`
- [ ] Integration test: Fallback to `gpt-5.2` works when mini unavailable
- [ ] Integration test: Incomplete response triggers fallback, not retry
- [ ] Load test: 10 concurrent reviews complete without circuit breaker trip

---

## Rollback Plan

If issues arise after deployment:

1. Set `OPENAI_REVIEW_MODEL=gpt-5.2` to bypass gpt-5-mini
2. Set `OPENAI_REVIEW_MAX_OUTPUT_TOKENS=8000` to restore old token limit
3. Feature flag `OPENAI_REVIEW_ZONE_RECONFIG=false` disables reviewer entirely

---

## Environment Variable Changes

| Variable | Old Default | New Default | Notes |
|----------|-------------|-------------|-------|
| `OPENAI_REVIEW_MODEL` | gpt-5.2 | gpt-5.2 | Keep full model for complex reasoning |
| `OPENAI_REVIEW_MAX_OUTPUT_TOKENS` | 8000 | 1500 | Reduced for speed |
| `OPENAI_REVIEW_REASONING_EFFORT` | medium | medium | Keep medium for spatial reasoning |

---

## Expected Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Latency | ~54s | ~10-15s | 4-5x faster |
| Tokens used | ~8k | ~1.5k | 5x reduction |
| Parse failures | Occasional | Zero | SDK handles edge cases |
| Cost per review | Same (gpt-5.2) | Same (gpt-5.2) | Quality over cost |
