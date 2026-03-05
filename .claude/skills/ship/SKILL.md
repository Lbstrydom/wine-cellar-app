---
name: ship
description: |
  Sync all project documentation, optionally update a plan, then commit and push to git.
  Updates status.md (session log), syncs CLAUDE.md to AGENTS.md, and handles git workflow.
  Use when the user is ready to commit and push their work.
  Usage: /ship — sync docs + commit + push
  Usage: /ship docs/plans/feature.md — also update the plan before committing
  Triggers on: "ship it", "commit and push", "push my changes", "ready to ship".
  IMPORTANT: This command runs autonomously — no confirmation prompts. The user invoking
  /ship is their approval to update docs, commit, and push in one uninterrupted flow.
disable-model-invocation: true
---

# Ship: Sync Docs → Commit → Push

You are running the ship workflow. This is a single command that ensures all project
documentation is current, then commits and pushes. Follow every step in order.

**Arguments**: `$ARGUMENTS` — optional path to a plan file to update (e.g., `docs/plans/feature.md`)

---

## Step 1 — Assess What Changed

Before updating any docs, understand the current state:

1. **Run `git status`** to see all modified, added, and untracked files
2. **Run `git diff --stat`** to see a summary of changes
3. **Run `git diff` on key changed files** to understand what was actually done
4. **Run `git log -5 --oneline`** to see recent commit style and context

Build a mental model of:
- What features/fixes were implemented
- Which files were created vs modified
- What area of the codebase was affected (backend, frontend, both)
- Whether new patterns or conventions were established

---

## Step 2 — Update status.md

Append a new session log entry to `status.md` in the project root.

**If `status.md` does not exist**, create it with a header:

```markdown
# Project Status Log

## <Today's Date> — <Brief Summary of Work>

### Changes
- <Bullet list of what was done, grouped logically>

### Files Affected
- <List of key files created or modified, with one-line purpose>

### Decisions Made
- <Any architectural or design decisions taken during this session>

### Next Steps
- <What remains to be done, if anything>

---
```

**If `status.md` already exists**, append the new entry at the TOP (below the header),
so the most recent session is always first.

**Rules for the log entry**:
- Be specific — name actual files, functions, and endpoints
- Be concise — this is a log, not documentation
- Include decisions — these are valuable context for future sessions
- Include blockers or open questions if any remain
- Date format: YYYY-MM-DD

---

## Step 3 — Update CLAUDE.md (If Needed)

Review whether the current session introduced anything that should be captured in CLAUDE.md:

### Check for new patterns:
- [ ] New route files or API endpoints added? → Update Backend Structure section
- [ ] New frontend modules added? → Update Frontend Structure section
- [ ] New service patterns established? → Document the pattern
- [ ] New environment variables introduced? → Update Environment Variables table
- [ ] New conventions or rules discovered? → Add to Do/Do NOT sections
- [ ] New test files or testing patterns? → Update Testing section

### Check for outdated information:
- [ ] File structure descriptions still accurate?
- [ ] Code examples still reflect current patterns?
- [ ] Configuration values still correct?

**If changes are needed**: Make the edits to CLAUDE.md, keeping the existing style and structure.

**If no changes needed**: Skip this step — do not make unnecessary edits.

---

## Step 4 — Sync AGENTS.md

AGENTS.md must mirror CLAUDE.md exactly. After any CLAUDE.md changes:

1. **Read CLAUDE.md** content
2. **Write to AGENTS.md** with identical content
3. **Verify** the files are in sync

If CLAUDE.md was not modified in Step 3, check whether AGENTS.md is already in sync.
If it is already identical, skip this step. If it has drifted, re-sync it.

**Important**: AGENTS.md should live in the same directory as CLAUDE.md (project root).

---

## Step 5 — Update Plan (If Plan Path Provided)

Only execute this step if `$ARGUMENTS` contains a plan file path.

1. **Read the plan file** at the provided path
2. **Compare against git diff** — which planned items were implemented in this session?
3. **Update the plan metadata**:
   - Change `Status: Draft` → `Status: In Progress` (if first implementation session)
   - Change `Status: In Progress` → `Status: Complete` (if all items done)
4. **Update the file-level plan** — mark completed items:

```markdown
| Planned Item | Status | Notes |
|-------------|--------|-------|
| `src/routes/feature.js` | ✅ Done | Implemented as planned |
| `src/services/feature.js` | ✅ Done | Added extra helper function |
| `public/js/feature.js` | ⏳ In Progress | Basic structure, needs event wiring |
| `tests/unit/feature.test.js` | ❌ Not Started | — |
```

5. **Add an implementation log entry** at the bottom of the plan:

```markdown
## Implementation Log

### <Today's Date>
- Completed: <what was built>
- Remaining: <what is left>
- Deviations: <any changes from the original plan and why>
```

6. **Flag any deviations** — if the implementation diverged from the plan,
   note what changed and why so the next session has context.

---

## Step 6 — Stage, Commit, and Push

### 6.1 Stage files

Stage all relevant files. Be specific — add files by name:

```bash
git add <list of changed source files>
git add status.md
git add CLAUDE.md AGENTS.md    # Only if they were modified
git add docs/plans/<plan>.md   # Only if plan was updated
```

**Do NOT stage**:
- `.env` or any file containing secrets
- `node_modules/`
- Temporary or generated files

If there are untracked files that look unintentional (random temp files, OS files),
skip them silently. Include all source code, docs, tests, and config files.

### 6.2 Generate commit message

Analyse the staged changes and create a commit message following the project convention:

```
<type>: <concise description of what changed>

<optional body with details if the change is significant>
```

**Types**: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`

- If changes span multiple types, use the primary type and mention others in the body
- Keep the first line under 72 characters
- The body should explain WHY, not WHAT (the diff shows what)

### 6.3 Commit and push

**The `/ship` command IS the user's approval.** Do NOT ask for confirmation.
Proceed directly — stage, commit, and push in one flow.

```bash
git commit -m "<message>"
git push origin <current-branch>
```

If push fails (e.g., behind remote), inform the user and suggest the fix.
Do NOT force push.

---

## Quick Reference

| Syntax | What Happens |
|--------|-------------|
| `/ship` | Update status.md → sync CLAUDE.md/AGENTS.md → commit → push |
| `/ship docs/plans/feature.md` | All of the above + update the plan file |

## Reminders

- **Always check git diff first** — understand what changed before documenting
- **status.md is a log** — append, never rewrite history
- **CLAUDE.md only changes when needed** — do not make cosmetic edits
- **AGENTS.md is a mirror** — always identical to CLAUDE.md
- **No confirmation needed** — `/ship` is the approval. Execute the full flow autonomously
- **Be specific in the log** — name files, functions, endpoints. Vague entries are useless
- **The commit message matters** — it is the permanent record in git history
