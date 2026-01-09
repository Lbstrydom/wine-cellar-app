/**
 * @fileoverview Tasting notes API endpoints.
 * Implements Wine Detail Panel Spec v2 API requirements.
 * @module routes/tastingNotes
 */

import { Router } from 'express';
import db from '../db/index.js';
import {
  getWineTastingNotes,
  saveWineTastingNotes,
  reportTastingNoteIssue,
  extractToV2
} from '../services/tastingNotesV2.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * Get structured tasting notes for a wine.
 * @route GET /api/wines/:id/tasting-notes
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const includeSources = req.query.include_sources === 'true';
    
    const notes = await getWineTastingNotes(Number.parseInt(id, 10));
    
    if (!notes) {
      return res.json({
        success: true,
        notes: null,
        message: 'No tasting notes available'
      });
    }
    
    // Optionally strip sources for smaller response
    const responseNotes = includeSources ? notes : {
      ...notes,
      sources: undefined
    };
    
    res.json({
      success: true,
      notes: responseNotes
    });
  } catch (error) {
    logger.error('TastingNotes', `Error fetching notes: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get tasting note sources for a wine.
 * @route GET /api/wines/:id/tasting-notes/sources
 */
router.get('/:id/sources', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sources = await db.prepare(`
      SELECT source_name, source_type, source_url, snippet, retrieved_at
      FROM tasting_note_sources
      WHERE wine_id = ?
      ORDER BY retrieved_at DESC
    `).all(Number.parseInt(id, 10));
    
    res.json({
      success: true,
      sources
    });
  } catch (error) {
    logger.error('TastingNotes', `Error fetching sources: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Regenerate tasting notes for a wine.
 * @route POST /api/wines/:id/tasting-notes/regenerate
 */
router.post('/:id/regenerate', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Get wine info
    const wine = await db.prepare(`
      SELECT id, wine_name, colour, style, grapes, vintage, tasting_notes
      FROM wines WHERE id = ?
    `).get(Number.parseInt(id, 10));
    
    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }
    
    if (!wine.tasting_notes) {
      return res.status(400).json({ error: 'No source tasting notes to regenerate from' });
    }
    
    // Re-extract with current normaliser
    const v2Notes = await extractToV2(wine.tasting_notes, {
      wineInfo: {
        colour: wine.colour,
        style: wine.style,
        grape: wine.grapes,
        vintage: wine.vintage
      },
      sourceId: 'regenerated',
      sourceType: 'unknown'
    });
    
    // Save
    await saveWineTastingNotes(wine.id, v2Notes);
    
    // Clear flags
    await db.prepare(`
      UPDATE wines SET 
        tasting_notes_needs_review = FALSE,
        tasting_notes_user_reported = FALSE
      WHERE id = ?
    `).run(wine.id);
    
    logger.info('TastingNotes', `Regenerated notes for wine ${wine.id} (reason: ${reason})`);
    
    res.json({
      success: true,
      notes: v2Notes,
      message: 'Tasting notes regenerated successfully'
    });
  } catch (error) {
    logger.error('TastingNotes', `Error regenerating notes: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Report an issue with tasting notes.
 * @route POST /api/wines/:id/tasting-notes/report
 */
router.post('/:id/report', async (req, res) => {
  try {
    const { id } = req.params;
    const { issue_type, details } = req.body;
    
    if (!issue_type) {
      return res.status(400).json({ error: 'issue_type is required' });
    }
    
    const validTypes = ['inaccurate', 'missing_info', 'wrong_wine', 'other'];
    if (!validTypes.includes(issue_type)) {
      return res.status(400).json({ 
        error: `issue_type must be one of: ${validTypes.join(', ')}` 
      });
    }
    
    const reportId = await reportTastingNoteIssue(
      Number.parseInt(id, 10),
      issue_type,
      details || ''
    );
    
    logger.info('TastingNotes', `Report ${reportId} created for wine ${id}: ${issue_type}`);
    
    res.json({
      success: true,
      report_id: reportId
    });
  } catch (error) {
    logger.error('TastingNotes', `Error creating report: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get pending tasting note reports (admin).
 * @route GET /api/tasting-notes/reports
 */
router.get('/reports', async (req, res) => {
  try {
    const status = req.query.status || 'open';
    
    const reports = await db.prepare(`
      SELECT 
        r.id,
        r.wine_id,
        r.issue_type,
        r.details,
        r.status,
        r.created_at,
        w.wine_name,
        w.vintage
      FROM tasting_note_reports r
      JOIN wines w ON w.id = r.wine_id
      WHERE r.status = ?
      ORDER BY r.created_at DESC
      LIMIT 100
    `).all(status);
    
    res.json({
      success: true,
      reports
    });
  } catch (error) {
    logger.error('TastingNotes', `Error fetching reports: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update report status (admin).
 * @route PUT /api/tasting-notes/reports/:reportId
 */
router.put('/reports/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['open', 'reviewed', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: `status must be one of: ${validStatuses.join(', ')}` 
      });
    }
    
    const resolvedAt = status === 'resolved' ? 'CURRENT_TIMESTAMP' : null;
    
    await db.prepare(`
      UPDATE tasting_note_reports SET 
        status = ?,
        resolved_at = ${resolvedAt ? 'CURRENT_TIMESTAMP' : 'NULL'}
      WHERE id = ?
    `).run(status, Number.parseInt(reportId, 10));
    
    res.json({
      success: true,
      message: `Report ${reportId} updated to ${status}`
    });
  } catch (error) {
    logger.error('TastingNotes', `Error updating report: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
