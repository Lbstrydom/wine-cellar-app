/**
 * @fileoverview Consistency check API endpoints.
 * Advisory-only wine data validation: audit cellar, check single wine, pre-save validate.
 * @module routes/consistency
 */

import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { checkWineConsistency, auditCellar } from '../services/shared/consistencyChecker.js';
import { validateQuery, validateParams, validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { WINE_COLOURS } from '../schemas/wine.js';

const router = Router();

/**
 * Audit query schema (R2-#17).
 */
const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  severity: z.enum(['error', 'warning', 'info']).optional(),
  includeUnknown: z.union([
    z.boolean(),
    z.enum(['true', 'false', '1', '0']).transform(v => v === 'true' || v === '1')
  ]).default(false),
});

/**
 * Wine ID param schema (R2-#17).
 */
const wineIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Invalid wine ID').transform(Number),
});

/**
 * Pre-save validation body schema (R2-#17).
 */
const validateBodySchema = z.object({
  wine_name: z.string().max(300).optional(),
  colour: z.enum(WINE_COLOURS).optional().nullable(),
  grapes: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  style: z.string().max(200).optional().nullable(),
  vintage: z.union([z.number().int(), z.null()]).optional(),
});

/**
 * Full cellar audit.
 * @route GET /api/consistency/audit
 */
router.get('/audit', validateQuery(auditQuerySchema), asyncHandler(async (req, res) => {
  const { limit, offset, severity, includeUnknown } = req.validated?.query || req.query;

  const result = await auditCellar(req.cellarId, {
    limit,
    offset,
    severity,
    includeUnknown,
  });

  res.json(result);
}));

/**
 * Check single wine by ID.
 * @route GET /api/consistency/check/:id
 */
router.get('/check/:id', validateParams(wineIdParamSchema), asyncHandler(async (req, res) => {
  const { id } = req.validated?.params || req.params;

  const wine = await db.prepare(`
    SELECT id, wine_name, vintage, colour, grapes, style
    FROM wines
    WHERE cellar_id = ? AND id = ?
  `).get(req.cellarId, id);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const finding = checkWineConsistency(wine);
  res.json({ data: finding });
}));

/**
 * Pre-save validation (wine fields in body).
 * @route POST /api/consistency/validate
 */
router.post('/validate', validateBody(validateBodySchema), asyncHandler(async (req, res) => {
  const wine = req.body;

  let finding = null;
  try {
    finding = checkWineConsistency(wine);
  } catch {
    // fail-open
  }

  res.json({ data: finding });
}));

export default router;
