/**
 * @fileoverview Layout sorter — computes the minimum set of moves
 * to transform the current cellar layout into the target layout.
 *
 * Uses permutation decomposition to identify:
 *  - Direct moves (wine → empty slot)
 *  - Swap pairs (A→B, B→A)
 *  - Cycles of length N (A→B→C→A)
 *
 * All moves are emitted as concrete { wineId, from, to } objects.
 * The `moveType` field is metadata only — the existing 2-phase transaction
 * executes all moves identically (Phase 1: clear sources, Phase 2: set targets).
 *
 * @module services/cellar/layoutSorter
 */

/**
 * Compute the minimum move plan to transform current → target layout.
 * Operates on slot instances, so one wineId may appear in multiple moves
 * (each with a distinct from/to pair).
 *
 * @param {Map<string, {wineId: number, wineName?: string, colour?: string, zoneId?: string}>} currentLayout
 * @param {Map<string, {wineId: number, wineName?: string, zoneId?: string, confidence?: string}>} targetLayout
 * @returns {{
 *   moves: Array<{wineId: number, wineName: string, from: string, to: string, zoneId: string, confidence: string, moveType: string}>,
 *   stats: {stayInPlace: number, directMoves: number, swaps: number, cycles: number, totalMoves: number}
 * }}
 */
export function computeSortPlan(currentLayout, targetLayout) {
  const moves = [];
  let stayInPlace = 0;
  let directMoves = 0;
  let swaps = 0;
  let cycles = 0;

  // ── 1. Build displacement map ──────────────────────────────
  // For each target slot, determine: who's there now vs. who should be there
  // displacement: targetSlot → { currentWineId, targetWineId, targetInfo }
  const displacements = new Map();

  for (const [targetSlot, targetInfo] of targetLayout) {
    const currentInfo = currentLayout.get(targetSlot);
    const currentWineId = currentInfo?.wineId ?? null;

    if (currentWineId === targetInfo.wineId) {
      stayInPlace++;
      continue; // Already correct — no move needed
    }

    displacements.set(targetSlot, {
      currentWineId,
      targetWineId: targetInfo.wineId,
      targetInfo
    });
  }

  // ── 2. Build reverse map: where does each wine currently sit? ─────
  // For wines that need to move: currentSlot → targetSlot
  // We need to know: for each wine in the target, where is it currently?
  const wineCurrentSlots = new Map(); // wineId → [slotId, ...]
  for (const [slotId, info] of currentLayout) {
    if (!wineCurrentSlots.has(info.wineId)) {
      wineCurrentSlots.set(info.wineId, []);
    }
    wineCurrentSlots.get(info.wineId).push(slotId);
  }

  // ── 3. Build permutation graph ─────────────────────────────
  // Each displacement creates an edge: wine at currentSlot needs to go to targetSlot.
  // We track: for each target slot, which current slot provides the wine?

  // Map: targetSlot → sourceSlot (where the wine currently is that should go to targetSlot)
  const targetToSource = new Map();
  const usedSources = new Set(); // Track which source slots we've matched

  for (const [targetSlot, disp] of displacements) {
    const wineId = disp.targetWineId;
    const candidates = wineCurrentSlots.get(wineId) || [];

    // Find an unmatched source slot for this wine
    let source = null;
    for (const candidate of candidates) {
      if (!usedSources.has(candidate)) {
        source = candidate;
        usedSources.add(candidate);
        break;
      }
    }

    if (source) {
      targetToSource.set(targetSlot, source);
    }
    // If no source found, wine isn't currently in the cellar — skip (shouldn't happen
    // with correct input, but defensive)
  }

  // ── 4. Decompose into direct moves, swaps, and cycles ─────
  const visited = new Set();

  for (const [targetSlot, sourceSlot] of targetToSource) {
    if (visited.has(targetSlot)) continue;

    // Walk the permutation cycle starting from targetSlot
    const cycle = [];
    let current = targetSlot;

    while (current && !visited.has(current)) {
      visited.add(current);
      const source = targetToSource.get(current);
      if (!source) break;

      const disp = displacements.get(current);
      cycle.push({
        targetSlot: current,
        sourceSlot: source,
        targetInfo: disp.targetInfo
      });

      // Follow the chain: does the source slot also need to receive a different wine?
      if (displacements.has(source) && !visited.has(source)) {
        current = source;
      } else {
        break;
      }
    }

    if (cycle.length === 0) continue;

    if (cycle.length === 1) {
      // Direct move: wine goes from sourceSlot to targetSlot
      const { sourceSlot: from, targetSlot: to, targetInfo } = cycle[0];
      directMoves++;
      moves.push({
        wineId: targetInfo.wineId,
        wineName: targetInfo.wineName || '',
        from,
        to,
        zoneId: targetInfo.zoneId || '',
        confidence: targetInfo.confidence || 'high',
        moveType: 'direct'
      });
    } else if (cycle.length === 2) {
      // Swap: A→B and B→A
      swaps++;
      for (const step of cycle) {
        moves.push({
          wineId: step.targetInfo.wineId,
          wineName: step.targetInfo.wineName || '',
          from: step.sourceSlot,
          to: step.targetSlot,
          zoneId: step.targetInfo.zoneId || '',
          confidence: step.targetInfo.confidence || 'high',
          moveType: 'swap'
        });
      }
    } else {
      // Cycle of length N
      cycles++;
      for (const step of cycle) {
        moves.push({
          wineId: step.targetInfo.wineId,
          wineName: step.targetInfo.wineName || '',
          from: step.sourceSlot,
          to: step.targetSlot,
          zoneId: step.targetInfo.zoneId || '',
          confidence: step.targetInfo.confidence || 'high',
          moveType: 'cycle'
        });
      }
    }
  }

  // ── 5. Handle remaining displacements (unmatched targets) ──
  // These are target slots that need a wine but no source was found
  // (e.g. wine is new or comes from outside the cellar)
  for (const [targetSlot, disp] of displacements) {
    if (visited.has(targetSlot)) continue;
    // No source slot — this is an anomaly; log but don't emit a move
    // (the wine would need to be added to the cellar first)
  }

  return {
    moves,
    stats: {
      stayInPlace,
      directMoves,
      swaps,
      cycles,
      totalMoves: moves.length
    }
  };
}
