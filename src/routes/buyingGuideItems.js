/**
 * @fileoverview Buying guide item (shopping cart) endpoints.
 * CRUD, status transitions, batch operations, cart summary,
 * style inference, and gap summary for browser extension.
 * @module routes/buyingGuideItems
 */

import { Router } from 'express';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  createItemSchema, updateItemSchema, updateStatusSchema,
  batchStatusSchema, listItemsQuerySchema, itemIdSchema,
  inferStyleSchema, toCellarSchema, batchArriveSchema
} from '../schemas/buyingGuideItem.js';
import * as cart from '../services/recipe/buyingGuideCart.js';
import { inferStyleForItem } from '../services/recipe/styleInference.js';
import { suggestPlacement, saveAcquiredWine, enrichWineData } from '../services/acquisitionWorkflow.js';
import { invalidateBuyingGuideCache } from '../services/recipe/buyingGuide.js';
import db, { wrapClient } from '../db/index.js';
import logger from '../utils/logger.js';

const router = Router();

/* ── Fixed-path routes (before /:id to avoid param capture) ── */

/**
 * List buying guide items.
 * @route GET /api/buying-guide-items
 */
router.get('/', validateQuery(listItemsQuerySchema), asyncHandler(async (req, res) => {
  const result = await cart.listItems(req.cellarId, req.query);
  res.json({ data: { items: result.items, total: result.total } });
}));

/**
 * Cart summary (counts + currency-segmented totals).
 * @route GET /api/buying-guide-items/summary
 */
router.get('/summary', asyncHandler(async (req, res) => {
  const summary = await cart.getCartSummary(req.cellarId);
  res.json({ data: summary });
}));

/**
 * Lightweight gap summary for extension popup.
 * Returns buying guide gaps + coverage percentages.
 * Uses server-side caching (Phase 3) when available.
 * @route GET /api/buying-guide-items/gaps
 */
router.get('/gaps', asyncHandler(async (req, res) => {
  const { generateBuyingGuide } = await import('../services/recipe/buyingGuide.js');
  const guide = await generateBuyingGuide(req.cellarId);

  res.json({
    data: {
      gaps: (guide.gaps || []).map(g => ({
        style: g.style,
        label: g.label,
        deficit: g.deficit,
        projectedDeficit: g.projectedDeficit ?? g.deficit,
        target: g.target,
        have: g.have,
        suggestions: g.suggestions
      })),
      coveragePct: guide.coveragePct ?? 0,
      bottleCoveragePct: guide.bottleCoveragePct ?? 0,
      projectedCoveragePct: guide.projectedCoveragePct ?? guide.coveragePct ?? 0,
      projectedBottleCoveragePct: guide.projectedBottleCoveragePct ?? guide.bottleCoveragePct ?? 0,
      activeCartItems: guide.activeCartItems ?? 0,
      activeCartBottles: guide.activeCartBottles ?? 0
    }
  });
}));

/**
 * Create a new buying guide item.
 * @route POST /api/buying-guide-items
 */
router.post('/', validateBody(createItemSchema), asyncHandler(async (req, res) => {
  const item = await cart.createItem(req.cellarId, req.body);
  res.status(201).json({ message: 'Item added to buying guide', data: item });
}));

/**
 * Infer style bucket from partial wine data.
 * Used by browser extension to classify wines before adding to cart.
 * @route POST /api/buying-guide-items/infer-style
 */
router.post('/infer-style', validateBody(inferStyleSchema), asyncHandler(async (req, res) => {
  const result = inferStyleForItem(req.body);
  res.json({ data: result });
}));

/**
 * Batch mark items as arrived.
 * @route POST /api/buying-guide-items/batch-arrive
 */
router.post('/batch-arrive', validateBody(batchArriveSchema), asyncHandler(async (req, res) => {
  const { updated, skipped } = await cart.batchUpdateStatus(req.cellarId, req.body.ids, 'arrived');
  res.json({
    message: `${updated} item(s) marked as arrived`,
    data: { updated, skipped }
  });
}));

/**
 * Batch status update.
 * @route PATCH /api/buying-guide-items/batch-status
 */
router.patch('/batch-status', validateBody(batchStatusSchema), asyncHandler(async (req, res) => {
  const { updated, skipped } = await cart.batchUpdateStatus(req.cellarId, req.body.ids, req.body.status);
  res.json({
    message: `${updated} item(s) updated`,
    data: { updated, skipped }
  });
}));

/* ── Parameterized routes (/:id) ─────────────────────────────── */

/**
 * Get a single item.
 * @route GET /api/buying-guide-items/:id
 */
router.get('/:id', validateParams(itemIdSchema), asyncHandler(async (req, res) => {
  const item = await cart.getItem(req.cellarId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json({ data: item });
}));

/**
 * Update a buying guide item.
 * @route PUT /api/buying-guide-items/:id
 */
router.put('/:id', validateParams(itemIdSchema), validateBody(updateItemSchema), asyncHandler(async (req, res) => {
  const item = await cart.updateItem(req.cellarId, req.params.id, req.body);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json({ message: 'Item updated', data: item });
}));

/**
 * Update item status (state machine validated).
 * @route PATCH /api/buying-guide-items/:id/status
 */
router.patch('/:id/status', validateParams(itemIdSchema), validateBody(updateStatusSchema), asyncHandler(async (req, res) => {
  const { item, error } = await cart.updateItemStatus(req.cellarId, req.params.id, req.body.status);
  if (error) {
    const status = error === 'Item not found' ? 404 : 400;
    return res.status(status).json({ error });
  }
  res.json({ message: `Status changed to ${req.body.status}`, data: item });
}));

/**
 * Delete a buying guide item (non-converted only).
 * @route DELETE /api/buying-guide-items/:id
 */
router.delete('/:id', validateParams(itemIdSchema), asyncHandler(async (req, res) => {
  const { deleted, error } = await cart.deleteItem(req.cellarId, req.params.id);
  if (error) {
    const status = error === 'Item not found' ? 404 : 400;
    return res.status(status).json({ error });
  }
  res.json({ message: 'Item deleted' });
}));

/* ── Arrival & Cellar Conversion ─────────────────────────────── */

/**
 * Mark item as arrived + get placement suggestion.
 * @route POST /api/buying-guide-items/:id/arrive
 */
router.post('/:id/arrive', validateParams(itemIdSchema), asyncHandler(async (req, res) => {
  const item = await cart.getItem(req.cellarId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  // Transition to arrived via state machine
  const { item: updated, error } = await cart.updateItemStatus(req.cellarId, req.params.id, 'arrived');
  if (error) return res.status(400).json({ error });

  // Get placement suggestion
  const wineObj = {
    wine_name: item.wine_name,
    colour: item.colour || null,
    style: item.style_id || null,
    grapes: item.grapes || null,
    region: item.region || null,
    country: item.country || null
  };

  let placement = null;
  try {
    placement = await suggestPlacement(wineObj, req.cellarId);
  } catch (err) {
    logger.warn('[buyingGuideItems] placement suggestion failed:', err.message);
  }

  res.json({
    message: 'Item marked as arrived',
    data: {
      item: updated,
      placement: placement ? {
        zoneId: placement.zone?.zoneId,
        zoneName: placement.zone?.displayName,
        suggestedSlot: placement.suggestedSlot,
        confidence: placement.zone?.confidence,
        alternatives: placement.zone?.alternatives
      } : null
    }
  });
}));

/**
 * Convert arrived item to a physical wine record + assign slot.
 * Supports partial conversion with row-splitting when fewer slots available.
 * Wrapped in a database transaction for atomicity.
 * @route POST /api/buying-guide-items/:id/to-cellar
 */
router.post('/:id/to-cellar', validateParams(itemIdSchema), validateBody(toCellarSchema), asyncHandler(async (req, res) => {
  const item = await cart.getItem(req.cellarId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  // Idempotency guard
  if (item.converted_wine_id != null) {
    return res.status(409).json({ error: 'Item already converted', wineId: item.converted_wine_id });
  }

  // Must be arrived
  if (item.status !== 'arrived') {
    return res.status(400).json({ error: `Item must be in 'arrived' status, currently '${item.status}'` });
  }

  const convertQuantity = req.body?.convertQuantity ?? item.quantity;

  // Pre-flight: count available slots
  const slotCount = await db.prepare(
    'SELECT COUNT(*) as count FROM slots WHERE cellar_id = ? AND wine_id IS NULL'
  ).get(req.cellarId);
  const available = Number(slotCount?.count) || 0;

  // Partial conversion check — ask user to confirm
  if (available < convertQuantity && !req.body?.confirmed) {
    return res.json({
      data: {
        partial: true,
        available,
        total: convertQuantity,
        requiresConfirmation: true,
        message: `Only ${available} of ${convertQuantity} slots available. Confirm to convert ${available} now.`
      }
    });
  }

  const qty = Math.min(convertQuantity, available);
  if (qty === 0) {
    return res.status(400).json({ error: 'No empty slots available' });
  }

  // Build wine data from cart item
  const wineData = {
    wine_name: item.wine_name,
    producer: item.producer || null,
    vintage: item.vintage || null,
    colour: item.colour || 'white',
    style: item.style_id || null,
    grapes: item.grapes || null,
    region: item.region || null,
    country: item.country || null
  };

  // Wrap conversion in a transaction for atomicity
  const result = await db.transaction(async (client) => {
    const txDb = wrapClient(client);

    // 1. Create wine record + assign slots
    const saveResult = await saveAcquiredWine(wineData, {
      cellarId: req.cellarId,
      quantity: qty,
      skipEnrichment: true,
      transaction: txDb
    });

    // 2. Invariant: verify slot assignment matches requested quantity
    if (!saveResult.slots || saveResult.slots.length < qty) {
      throw new Error(
        `Slot assignment mismatch: requested ${qty}, assigned ${saveResult.slots?.length ?? 0}`
      );
    }

    // 3. Update original cart item: reduce quantity + set converted_wine_id
    await txDb.prepare(
      'UPDATE buying_guide_items SET quantity = ?, converted_wine_id = ?, updated_at = NOW() WHERE id = ? AND cellar_id = ?'
    ).run(qty, saveResult.wineId, item.id, req.cellarId);

    // 4. If partial: insert remainder row to preserve virtual inventory
    if (qty < item.quantity) {
      const remainder = item.quantity - qty;
      await txDb.prepare(`
        INSERT INTO buying_guide_items (
          cellar_id, wine_name, producer, quantity, style_id, status,
          inferred_style_confidence, price, currency, vendor_url, vintage,
          colour, grapes, region, country, notes, source, source_gap_style
        ) VALUES (?, ?, ?, ?, ?, 'arrived', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.cellarId, item.wine_name, item.producer || null, remainder,
        item.style_id || null, item.inferred_style_confidence || null,
        item.price ?? null, item.currency || 'ZAR', item.vendor_url || null,
        item.vintage ?? null, item.colour || null, item.grapes || null,
        item.region || null, item.country || null, item.notes || null,
        item.source || 'manual', item.source_gap_style || null
      );
    }

    return {
      wineId: saveResult.wineId,
      slots: saveResult.slots,
      partial: qty < item.quantity,
      converted: qty,
      remaining: item.quantity - qty
    };
  });

  // Post-transaction: invalidate cache + queue enrichment (fire-and-forget)
  invalidateBuyingGuideCache(req.cellarId).catch(() => {});
  enrichWineData({ ...wineData, id: result.wineId }).catch(err => {
    logger.warn('[buyingGuideItems] post-conversion enrichment failed:', err.message);
  });

  res.json({
    message: `Converted ${result.converted} bottle(s) to cellar`,
    data: result
  });
}));

export default router;
