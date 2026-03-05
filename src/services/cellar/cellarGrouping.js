/**
 * @fileoverview Target-first grouping algorithm for same-wine bottle arrangement.
 * Pure functions with zero DB dependencies — fully testable in isolation.
 *
 * Algorithm overview:
 *   1. Identify wine groups (wines with 2+ bottles in the row).
 *   2. Greedily assign each group a minimum-cost contiguous target block,
 *      largest groups first, without conflicting with already-committed blocks.
 *   3. For any target position occupied by a wine not in the movement plan,
 *      insert a forced displacement move (creates a swap).
 *   4. Decompose all movements into cycles (true permutation cycles) and chains
 *      (paths ending at currently-empty slots or slots freed by earlier steps).
 *   5. Order steps: simple moves first, swaps next, longer rotations last.
 *
 * @module services/cellar/cellarGrouping
 */

// ───────────────────────────────────────────────────────────
// Type definitions (JSDoc only)
// ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} BoardEntry
 * @property {number|string} wineId - Wine identifier
 * @property {string} wineName - Wine display name
 */

/**
 * @typedef {Object} GroupingMove
 * @property {number} from - Source column (1-based)
 * @property {number} to - Target column (1-based)
 * @property {number|string} wineId - Wine identifier
 * @property {string} wineName - Wine display name
 * @property {boolean} isDisplacement - True when the wine is moved to make room for another
 */

/**
 * @typedef {Object} GroupingStep
 * @property {number} stepNumber - Sequential step number (1-based, after final ordering)
 * @property {'move'|'swap'|'rotation'} stepType - Atomic operation type
 * @property {GroupingMove[]} moves - Moves executed together as one atomic batch
 */

/**
 * @typedef {Object} GroupingPlan
 * @property {GroupingStep[]} steps - Ordered, atomic steps to achieve full grouping
 * @property {number} cost - Total displacement cost (Σ |from − to| over all moves)
 */

// ───────────────────────────────────────────────────────────
// Core algorithm
// ───────────────────────────────────────────────────────────

/**
 * Plan the optimal rearrangement to make every multi-bottle wine contiguous in a row.
 *
 * Each Step is an *atomic batch*:
 *  - 1 move  → simple move to an empty (or freed) slot
 *  - 2 moves → swap (A→B and B→A executed together)
 *  - k moves → k-element rotation cycle, executed together
 *
 * The returned steps, executed in order, are safe to pass directly to the
 * `POST /api/cellar/execute-moves` 2-phase transaction endpoint.
 *
 * Steps are ordered: simple moves first (no dependencies), then swaps,
 * then longer rotation cycles.  Within each category, earlier steps have
 * no dependency on later ones.
 *
 * @param {Map<number, BoardEntry>} board
 *   Current row state. Keys are 1-based column numbers; only occupied slots need
 *   be present.  The Map is not mutated.
 * @param {number} maxCol - Inclusive maximum column number for this row
 * @returns {GroupingPlan}
 */
export function planRowGrouping(board, maxCol) {
  if (!board || board.size === 0 || maxCol < 1) {
    return { steps: [], cost: 0 };
  }

  // ── 1. Build wine groups ─────────────────────────────────
  /** @type {Map<number|string, {cols: number[], wineName: string}>} */
  const wineGroups = new Map();
  for (const [col, entry] of board) {
    if (!wineGroups.has(entry.wineId)) {
      wineGroups.set(entry.wineId, { cols: [], wineName: entry.wineName });
    }
    wineGroups.get(entry.wineId).cols.push(col);
  }

  // Only multi-bottle wines need grouping
  const multiWines = [...wineGroups.entries()]
    .filter(([, g]) => g.cols.length >= 2)
    .map(([wineId, g]) => ({
      wineId,
      wineName: g.wineName,
      sortedCols: g.cols.slice().sort((a, b) => a - b)
    }));

  if (multiWines.length === 0) return { steps: [], cost: 0 };

  // Sort: largest group first; ties broken by leftmost current position
  multiWines.sort((a, b) => {
    if (b.sortedCols.length !== a.sortedCols.length) {
      return b.sortedCols.length - a.sortedCols.length;
    }
    return a.sortedCols[0] - b.sortedCols[0];
  });

  // ── 2. Assign minimum-cost contiguous target blocks ──────
  // Use backtracking search to find block assignments for all multi-bottle wines.
  // Each wine needs a contiguous block of `n` columns with no overlap.
  // We search for the combination with minimum total cost that assigns ALL wines.
  //
  // Greedy-first with backtrack: try cheapest block first, backtrack if later wines
  // can't be assigned. Worst case O(maxCol^W) where W = number of wines (typically 2-4).
  // Cost-based pruning (branch-and-bound) keeps practical runtime low.
  // TODO (Phase 3.1): Add candidate count limiter for extreme cases (W>5, maxCol>20).

  /**
   * @type {Map<number, {to: number, isDisplacement: boolean}>}
   * Maps source column → move descriptor.  Only populated for moves where from ≠ to.
   */
  const targetOf = new Map();

  /**
   * Recursively assign contiguous blocks to each wine in `wines`.
   * Returns the assignment with fewest unassigned wines (nulls) and lowest cost among ties.
   * @param {number} wi - Index into multiWines array
   * @param {Set<number>} committed - Columns already reserved (mutated in place, restored on backtrack)
   * @param {Array<number|null>} starts - Current start positions, one per wine
   * @param {number} costSoFar
   * @returns {{ starts: number[], cost: number, nullCount: number } | null}
   */
  function findAssignment(wi, committed, starts, costSoFar) {
    if (wi === multiWines.length) {
      const nullCount = starts.filter(s => s === null).length;
      return { starts: starts.slice(), cost: costSoFar, nullCount };
    }

    const { sortedCols } = multiWines[wi];
    const n = sortedCols.length;

    // Enumerate all candidate start positions, sorted by cost (cheapest first).
    const candidates = [];
    for (let start = 1; start <= maxCol - n + 1; start++) {
      let conflict = false;
      for (let i = 0; i < n; i++) {
        if (committed.has(start + i)) { conflict = true; break; }
      }
      if (conflict) continue;
      let cost = 0;
      for (let i = 0; i < n; i++) cost += Math.abs(sortedCols[i] - (start + i));
      candidates.push({ start, cost });
    }
    candidates.sort((a, b) => a.cost - b.cost);

    let bestResult = null;

    for (const { start, cost } of candidates) {
      // Prune: if we already have a zero-null result and this candidate's partial
      // cost already meets or exceeds it, no child assignment can improve.
      if (bestResult && bestResult.nullCount === 0 && costSoFar + cost >= bestResult.cost) {
        continue;
      }

      // Commit this block
      for (let i = 0; i < n; i++) committed.add(start + i);
      starts[wi] = start;
      const result = findAssignment(wi + 1, committed, starts, costSoFar + cost);
      // Backtrack
      for (let i = 0; i < n; i++) committed.delete(start + i);
      starts[wi] = null;

      if (result) {
        // Prefer results with fewer nulls; among equal nulls, prefer lower cost
        if (!bestResult || result.nullCount < bestResult.nullCount ||
            (result.nullCount === bestResult.nullCount && result.cost < bestResult.cost)) {
          bestResult = result;
        }
        // Cost 0 is provably optimal — no further search needed
        if (bestResult.nullCount === 0 && bestResult.cost === 0) return bestResult;
      }
    }

    // Try leaving this wine unassigned (fallback) and compare with best from candidates.
    // Reserve only the columns not already committed by an ancestor wine — avoids
    // removing columns that we did not ourselves add (which would corrupt committed
    // and allow overlap collisions for subsequent wines).
    const newlyAdded = [];
    for (const c of sortedCols) {
      if (!committed.has(c)) {
        committed.add(c);
        newlyAdded.push(c);
      }
    }
    starts[wi] = null;
    const fallback = findAssignment(wi + 1, committed, starts, costSoFar);
    newlyAdded.forEach(c => committed.delete(c));
    starts[wi] = null;

    if (fallback) {
      if (!bestResult || fallback.nullCount < bestResult.nullCount ||
          (fallback.nullCount === bestResult.nullCount && fallback.cost < bestResult.cost)) {
        bestResult = fallback;
      }
    }

    return bestResult || null;
  }



  const initialCommitted = new Set();
  const initialStarts = new Array(multiWines.length).fill(null);
  const assignmentResult = findAssignment(0, initialCommitted, initialStarts, 0);

  // Build targetOf from the assignment result
  if (assignmentResult) {
    for (let wi = 0; wi < multiWines.length; wi++) {
      const { sortedCols } = multiWines[wi];
      const bestStart = assignmentResult.starts[wi];
      if (bestStart === null) {
        // Left in place as fallback — no moves recorded
        continue;
      }
      const n = sortedCols.length;
      for (let i = 0; i < n; i++) {
        const fromCol = sortedCols[i];
        const toCol = bestStart + i;
        if (fromCol !== toCol) {
          targetOf.set(fromCol, { to: toCol, isDisplacement: false });
        }
      }
    }
  }

  if (targetOf.size === 0) return { steps: [], cost: 0 };

  // ── 3. Insert forced displacement moves ─────────────────
  // Build a backward map to trace chains: targetCol → sourceCol
  const backwardPre = new Map();
  for (const [from, mv] of targetOf) backwardPre.set(mv.to, from);

  // When a target position is occupied by a wine with no planned move, we displace it.
  // The displacement wine goes to the CHAIN HEAD's source column — the one slot that
  // will truly be vacated (chain head has no predecessor pointing to it).
  //
  // Example: targetOf = {4→5, 5→2}, board has wine3@2 (no planned move).
  //   Chain: 4 → 5 → 2 (2 is empty tail). Chain head = col 4 (no predecessor).
  //   Wine1@4 moves to 5, Wine2@5 moves to 2. Col 4 becomes vacant.
  //   Displaced wine3@2 → goes to col 4 (the chain head's source).
  const pendingDisplacements = new Map(); // toCol (occupied target) → vacated col for displaced wine
  for (const [fromCol, move] of targetOf) {
    const toCol = move.to;
    if (!board.has(toCol)) continue; // target is already empty — no displacement needed
    if (targetOf.has(toCol)) continue; // target wine already has a planned move

    // toCol is occupied by a non-plan wine. Find the chain head that starts at fromCol.
    // Walk backward through backwardPre to find the true chain head (no predecessor).
    let chainHead = fromCol;
    const headVisited = new Set([fromCol]);
    let prev = backwardPre.get(chainHead);
    while (prev !== undefined && !headVisited.has(prev)) {
      headVisited.add(prev);
      chainHead = prev;
      prev = backwardPre.get(chainHead);
    }

    // The chain head (chainHead) leaves its source slot empty — that's the true vacancy.
    pendingDisplacements.set(toCol, chainHead);
  }
  for (const [fromCol, toCol] of pendingDisplacements) {
    if (!targetOf.has(fromCol)) {
      targetOf.set(fromCol, { to: toCol, isDisplacement: true });
    }
  }

  // ── 4. Find cycles and chains in the movement graph ─────
  // Build reverse map: targetCol → sourceCol
  const backward = new Map();
  for (const [from, mv] of targetOf) backward.set(mv.to, from);

  // Identify all columns that are part of a permutation cycle
  const inCycle = new Set();
  const cycleVisited = new Set();

  for (const [startCol] of targetOf) {
    if (cycleVisited.has(startCol)) continue;

    const path = [];
    const pathSet = new Set();
    let cur = startCol;

    while (targetOf.has(cur) && !pathSet.has(cur) && !cycleVisited.has(cur)) {
      pathSet.add(cur);
      path.push(cur);
      cur = targetOf.get(cur).to;
    }

    if (pathSet.has(cur)) {
      // `cur` is the entry-point of the cycle within this path
      const cycleStartIdx = path.indexOf(cur);
      for (let i = cycleStartIdx; i < path.length; i++) inCycle.add(path[i]);
    }
    path.forEach(c => cycleVisited.add(c));
  }

  // ── 5. Build steps ───────────────────────────────────────
  const steps = [];
  let totalCost = 0;
  const processedCols = new Set();

  // 5a. Cycles — each cycle becomes one atomic step
  for (const cycleCol of inCycle) {
    if (processedCols.has(cycleCol)) continue;

    const cycleMoves = [];
    let cur = cycleCol;
    do {
      const mv = targetOf.get(cur);
      const boardEntry = board.get(cur);
      cycleMoves.push({
        from: cur,
        to: mv.to,
        wineId: boardEntry ? boardEntry.wineId : cur,
        wineName: boardEntry ? boardEntry.wineName : '',
        isDisplacement: mv.isDisplacement
      });
      processedCols.add(cur);
      cur = mv.to;
    } while (cur !== cycleCol);

    const stepType = cycleMoves.length === 2 ? 'swap' : 'rotation';
    steps.push({ stepType, moves: cycleMoves });
    totalCost += cycleMoves.reduce((s, m) => s + Math.abs(m.from - m.to), 0);
  }

  // 5b. Chains — each move in the chain becomes a single-move step,
  //     processed from tail (empty destination) to head.
  for (const [startCol] of targetOf) {
    if (processedCols.has(startCol)) continue;

    // Only process chain heads (no unprocessed non-cycle predecessor)
    const pointedToBy = backward.get(startCol);
    if (
      pointedToBy !== undefined &&
      !processedCols.has(pointedToBy) &&
      !inCycle.has(pointedToBy)
    ) {
      continue;
    }

    // Trace chain head → tail
    const chain = [];
    let cur = startCol;
    while (targetOf.has(cur) && !inCycle.has(cur) && !processedCols.has(cur)) {
      chain.push(cur);
      cur = targetOf.get(cur).to;
    }

    // Process tail-first so each target is free
    for (let i = chain.length - 1; i >= 0; i--) {
      const col = chain[i];
      const mv = targetOf.get(col);
      const boardEntry = board.get(col);
      steps.push({
        stepType: 'move',
        moves: [{
          from: col,
          to: mv.to,
          wineId: boardEntry ? boardEntry.wineId : col,
          wineName: boardEntry ? boardEntry.wineName : '',
          isDisplacement: mv.isDisplacement
        }]
      });
      totalCost += Math.abs(col - mv.to);
      processedCols.add(col);
    }
  }

  // ── 6. Sort steps (moves first, then swaps, then rotations) and number ──
  const typeOrder = { move: 0, swap: 1, rotation: 2 };
  steps.sort((a, b) => (typeOrder[a.stepType] ?? 1) - (typeOrder[b.stepType] ?? 1));
  steps.forEach((s, i) => { s.stepNumber = i + 1; });

  return { steps, cost: totalCost };
}
