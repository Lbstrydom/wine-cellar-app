/**
 * @fileoverview Score format definitions for normalisation.
 * @module config/scoreFormats
 */

/**
 * Score format definitions for known sources.
 * Each format includes examples and normalisation logic.
 */
const scoreFormats = {
  // =============================================================================
  // Critics - 100-point scale
  // =============================================================================
  robert_parker: {
    name: 'Wine Advocate / Robert Parker',
    type: 'points',
    scale: 100,
    examples: ['92', '95+', '88-90', '96-98'],
    normalisation_hint: 'use as-is (already 100-point)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3})/);
      return match ? parseInt(match[1]) : null;
    }
  },

  wine_spectator: {
    name: 'Wine Spectator',
    type: 'points',
    scale: 100,
    examples: ['92', '88', '95'],
    normalisation_hint: 'use as-is (already 100-point)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3})/);
      return match ? parseInt(match[1]) : null;
    }
  },

  vinous: {
    name: 'Vinous (Antonio Galloni)',
    type: 'points',
    scale: 100,
    examples: ['93', '91+', '89-91'],
    normalisation_hint: 'use as-is (already 100-point)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3})/);
      return match ? parseInt(match[1]) : null;
    }
  },

  james_suckling: {
    name: 'James Suckling',
    type: 'points',
    scale: 100,
    examples: ['94', '91', '97'],
    normalisation_hint: 'use as-is (already 100-point)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3})/);
      return match ? parseInt(match[1]) : null;
    }
  },

  wine_enthusiast: {
    name: 'Wine Enthusiast',
    type: 'points',
    scale: 100,
    examples: ['90', '87', '93'],
    normalisation_hint: 'use as-is (already 100-point)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3})/);
      return match ? parseInt(match[1]) : null;
    }
  },

  decanter: {
    name: 'Decanter Reviews',
    type: 'points',
    scale: 100,
    examples: ['92', '89', '95'],
    normalisation_hint: 'use as-is (already 100-point)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3})/);
      return match ? parseInt(match[1]) : null;
    }
  },

  // =============================================================================
  // Critics - 20-point scale
  // =============================================================================
  jancis_robinson: {
    name: 'Jancis Robinson',
    type: 'points',
    scale: 20,
    examples: ['17/20', '16.5', '18.5/20', '15.5'],
    normalisation_hint: 'multiply by 5',
    normalise: (raw) => {
      const match = raw.match(/(\d{1,2}(?:\.\d)?)/);
      if (match) {
        const score = parseFloat(match[1]);
        // If clearly on 20-point scale
        return score <= 20 ? Math.round(score * 5) : score;
      }
      return null;
    }
  },

  // =============================================================================
  // Italian Guides - Symbol-based
  // =============================================================================
  gambero_rosso: {
    name: 'Gambero Rosso',
    type: 'symbol',
    examples: ['Tre Bicchieri', 'Due Bicchieri Rossi', 'Due Bicchieri', 'Un Bicchiere'],
    normalisation_hint: 'Tre Bicchieri=95, Due Bicchieri Rossi=90, Due Bicchieri=87, Un Bicchiere=80',
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('tre bicchieri')) return 95;
      if (lower.includes('due bicchieri rossi')) return 90;
      if (lower.includes('due bicchieri')) return 87;
      if (lower.includes('un bicchiere') || lower.includes('uno bicchiere')) return 80;
      // Handle numeric references
      const numMatch = lower.match(/(\d)\s*bicchieri/);
      if (numMatch) {
        const count = parseInt(numMatch[1]);
        if (count === 3) return 95;
        if (count === 2) return 87;
        if (count === 1) return 80;
      }
      return null;
    }
  },

  bibenda: {
    name: 'Bibenda',
    type: 'symbol',
    examples: ['5 grappoli', 'cinque grappoli', '4 grappoli', 'quattro grappoli'],
    normalisation_hint: '5 grappoli=95, 4 grappoli=90, 3 grappoli=85, 2 grappoli=80',
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('cinque') || lower.includes('5 grappoli')) return 95;
      if (lower.includes('quattro') || lower.includes('4 grappoli')) return 90;
      if (lower.includes('tre') || lower.includes('3 grappoli')) return 85;
      if (lower.includes('due') || lower.includes('2 grappoli')) return 80;
      return null;
    }
  },

  doctor_wine: {
    name: 'Doctor Wine',
    type: 'points',
    scale: 100,
    examples: ['93', '90', '95'],
    normalisation_hint: 'use as-is (100-point scale)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3})/);
      return match ? parseInt(match[1]) : null;
    }
  },

  // =============================================================================
  // French Guides - Symbol-based
  // =============================================================================
  guide_hachette: {
    name: 'Guide Hachette',
    type: 'symbol',
    examples: ['★★★', '★★', '★', 'Coup de Cœur', '3 étoiles', '2 étoiles'],
    normalisation_hint: 'Coup de Cœur=96, ★★★=94, ★★=88, ★=82',
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('coup de') || lower.includes('cœur') || lower.includes('coeur')) return 96;
      // Count stars
      const starCount = (raw.match(/★/g) || []).length;
      if (starCount === 3 || lower.includes('3 étoiles') || lower.includes('trois étoiles')) return 94;
      if (starCount === 2 || lower.includes('2 étoiles') || lower.includes('deux étoiles')) return 88;
      if (starCount === 1 || lower.includes('1 étoile') || lower.includes('une étoile')) return 82;
      return null;
    }
  },

  rvf: {
    name: 'Revue du Vin de France',
    type: 'points',
    scale: 20,
    examples: ['17/20', '16', '18.5/20'],
    normalisation_hint: 'multiply by 5',
    normalise: (raw) => {
      const match = raw.match(/(\d{1,2}(?:\.\d)?)/);
      if (match) {
        const score = parseFloat(match[1]);
        return score <= 20 ? Math.round(score * 5) : score;
      }
      return null;
    }
  },

  bettane_desseauve: {
    name: 'Bettane+Desseauve',
    type: 'points',
    scale: 20,
    examples: ['16/20', '17.5', '15'],
    normalisation_hint: 'multiply by 5',
    normalise: (raw) => {
      const match = raw.match(/(\d{1,2}(?:\.\d)?)/);
      if (match) {
        const score = parseFloat(match[1]);
        return score <= 20 ? Math.round(score * 5) : score;
      }
      return null;
    }
  },

  // =============================================================================
  // South African - Stars
  // =============================================================================
  platters: {
    name: "Platter's Wine Guide",
    type: 'stars',
    scale: 5,
    examples: ['5 stars', '4.5 stars', '4 stars', '★★★★★', '★★★★½'],
    normalisation_hint: '5 stars=100, 4.5=95, 4=90, 3.5=85, 3=80',
    normalise: (raw) => {
      // Check for half star notation
      const halfMatch = raw.match(/(\d)½/);
      if (halfMatch) {
        const stars = parseInt(halfMatch[1]) + 0.5;
        return Math.round(stars * 20);
      }
      // Check for decimal notation
      const decMatch = raw.match(/(\d(?:\.\d)?)\s*stars?/i);
      if (decMatch) {
        const stars = parseFloat(decMatch[1]);
        return Math.round(stars * 20);
      }
      // Count star symbols
      const starCount = (raw.match(/★/g) || []).length;
      const halfStarCount = (raw.match(/½/g) || []).length;
      if (starCount > 0) {
        return Math.round((starCount + halfStarCount * 0.5) * 20);
      }
      return null;
    }
  },

  // =============================================================================
  // Australian - Points/Stars
  // =============================================================================
  halliday: {
    name: 'James Halliday Wine Companion',
    type: 'points',
    scale: 100,
    examples: ['95', '92', '97'],
    normalisation_hint: 'use as-is (100-point scale)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3})/);
      return match ? parseInt(match[1]) : null;
    }
  },

  // =============================================================================
  // German/Austrian - Points
  // =============================================================================
  falstaff: {
    name: 'Falstaff',
    type: 'points',
    scale: 100,
    examples: ['93', '90', '95'],
    normalisation_hint: 'use as-is (100-point scale)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3})/);
      return match ? parseInt(match[1]) : null;
    }
  },

  vinum: {
    name: 'Vinum',
    type: 'points',
    scale: 20,
    examples: ['17/20', '16', '18'],
    normalisation_hint: 'multiply by 5',
    normalise: (raw) => {
      const match = raw.match(/(\d{1,2}(?:\.\d)?)/);
      if (match) {
        const score = parseFloat(match[1]);
        return score <= 20 ? Math.round(score * 5) : score;
      }
      return null;
    }
  },

  // =============================================================================
  // Community - Stars/Points
  // =============================================================================
  vivino: {
    name: 'Vivino',
    type: 'stars',
    scale: 5,
    examples: ['4.2', '3.8', '4.5/5', '4.1 stars'],
    normalisation_hint: 'multiply by 20',
    normalise: (raw) => {
      const match = raw.match(/(\d(?:\.\d)?)/);
      if (match) {
        const rating = parseFloat(match[1]);
        return rating <= 5 ? Math.round(rating * 20) : rating;
      }
      return null;
    }
  },

  cellartracker: {
    name: 'CellarTracker',
    type: 'points',
    scale: 100,
    examples: ['CT89', '91', '87.5'],
    normalisation_hint: 'use as-is (100-point scale)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3}(?:\.\d)?)/);
      return match ? Math.round(parseFloat(match[1])) : null;
    }
  },

  // =============================================================================
  // Competition Medals
  // =============================================================================
  competition_medal: {
    name: 'Competition Medal',
    type: 'medal',
    examples: ['Gold', 'Silver', 'Bronze', 'Trophy', 'Grand Gold', 'Double Gold', 'Platinum'],
    normalisation_hint: 'Trophy/Platinum=98, Grand Gold/Double Gold=96, Gold=94, Silver=88, Bronze=82',
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('trophy') || lower.includes('platinum') || lower.includes('best in show')) return 98;
      if (lower.includes('grand gold') || lower.includes('double gold')) return 96;
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      if (lower.includes('commended') || lower.includes('mention') || lower.includes('seal')) return 78;
      return null;
    }
  },

  // DWWA specific
  dwwa: {
    name: 'Decanter World Wine Awards',
    type: 'medal',
    examples: ['Best in Show', 'Platinum', 'Gold', 'Silver', 'Bronze', 'Commended'],
    normalisation_hint: 'Best in Show=99, Platinum=97, Gold=94, Silver=88, Bronze=82, Commended=78',
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('best in show')) return 99;
      if (lower.includes('platinum')) return 97;
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      if (lower.includes('commended')) return 78;
      return null;
    }
  },

  // IWC specific
  iwc: {
    name: 'International Wine Challenge',
    type: 'medal',
    examples: ['Trophy', 'Gold', 'Silver', 'Bronze', 'Commended'],
    normalisation_hint: 'Trophy=98, Gold=94, Silver=88, Bronze=82, Commended=78',
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('trophy')) return 98;
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      if (lower.includes('commended')) return 78;
      return null;
    }
  },

  // IWSC specific
  iwsc: {
    name: 'International Wine & Spirit Competition',
    type: 'medal',
    examples: ['Trophy', 'Gold Outstanding', 'Gold', 'Silver Outstanding', 'Silver', 'Bronze'],
    normalisation_hint: 'Trophy=98, Gold Outstanding=96, Gold=94, Silver Outstanding=90, Silver=88, Bronze=82',
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('trophy')) return 98;
      if (lower.includes('gold outstanding')) return 96;
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver outstanding')) return 90;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      return null;
    }
  }
};

/**
 * Get score format for a source.
 * @param {string} sourceId - Source identifier
 * @returns {Object|null} Score format or null
 */
export function getScoreFormat(sourceId) {
  return scoreFormats[sourceId] || null;
}

/**
 * Normalise a raw score using the appropriate format.
 * @param {string} sourceId - Source identifier
 * @param {string} rawScore - Raw score string
 * @returns {number|null} Normalised score (0-100) or null
 */
export function normaliseScore(sourceId, rawScore) {
  const format = scoreFormats[sourceId];
  if (format && format.normalise) {
    return format.normalise(rawScore);
  }
  // Fallback: try to parse as number
  const match = rawScore.match(/(\d{2,3}(?:\.\d)?)/);
  return match ? Math.round(parseFloat(match[1])) : null;
}

/**
 * Get all score formats for prompt building.
 * @param {string[]} sourceIds - Array of source identifiers
 * @returns {Object[]} Array of relevant score formats
 */
export function getScoreFormatsForSources(sourceIds) {
  return sourceIds
    .map(id => {
      const format = scoreFormats[id];
      if (format) {
        return {
          id,
          name: format.name,
          type: format.type,
          examples: format.examples,
          hint: format.normalisation_hint
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Build prompt instructions for score extraction.
 * @param {string[]} sourceIds - Source identifiers found in search
 * @returns {string} Prompt text for score extraction
 */
export function buildScoreFormatPrompt(sourceIds) {
  const formats = getScoreFormatsForSources(sourceIds);

  if (formats.length === 0) return '';

  return `
Score formats to recognise:
${formats.map(f => `- ${f.name}: ${f.examples.join(', ')} → ${f.hint}`).join('\n')}
`;
}

export default scoreFormats;
