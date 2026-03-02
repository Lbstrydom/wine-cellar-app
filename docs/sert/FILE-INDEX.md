# SERT File Index

Copied source and test files for the web search architecture handoff.
All paths are relative to `docs/sert/relevant-files/`.

## Source Files
- `src/commands/researchCommands.ts` — Command registration and entry point
- `src/core/settings.ts` — Plugin settings schema (research settings subset)
- `src/services/adapters/providerRegistry.ts` — LLM provider defaults
- `src/services/cloudService.ts` — Cloud LLM service facade
- `src/services/llmFacade.ts` — Unified LLM interface (summarizeText, streaming)
- `src/services/localService.ts` — Local LLM service (Ollama etc.)
- `src/services/prompts/researchPrompts.ts` — All research prompts (decomposition, triage, extraction, synthesis)
- `src/services/research/academicUtils.ts` — DOI extraction, academic query expansion
- `src/services/research/adapters/brightdataSerpAdapter.ts` — Bright Data SERP provider
- `src/services/research/adapters/claudeWebSearchAdapter.ts` — Claude Web Search provider (single-call path)
- `src/services/research/adapters/tavilyAdapter.ts` — Tavily search provider
- `src/services/research/researchOrchestrator.ts` — Business logic orchestrator
- `src/services/research/researchSearchService.ts` — Provider registry, multi-query search, dedup
- `src/services/research/researchTypes.ts` — Shared TypeScript types
- `src/services/research/researchUsageService.ts` — Cost tracking and budget enforcement
- `src/services/research/sourceQualityService.ts` — Deterministic quality scoring (5 signals)
- `src/services/research/zoteroBridgeService.ts` — Zotero export integration
- `src/ui/chat/ResearchModeHandler.ts` — UI state machine and rendering
- `src/ui/modals/UnifiedChatModal.ts` — Modal shell for research chat
- `src/ui/settings/ResearchSettingsSection.ts` — Research settings UI
- `src/utils/urlUtils.ts` — URL normalization, domain classification

## Test Files
- `tests/claudeWebSearchAdapter.test.ts` — 60 adapter unit tests
- `tests/claudeWebSearchIntegration.test.ts` — 22 orchestrator integration tests
- `tests/claudeWebSearchStreaming.test.ts` — 56 streaming tests
- `tests/researchOrchestrator.test.ts` — 41 orchestrator tests
- `tests/researchSearchService.test.ts` — Search service tests
- `tests/researchUsageService.test.ts` — 24 usage ledger tests
