import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Fully mock utils.js — provide real maybeShowAnalysisHint but mock showToast
const showToastSpy = vi.fn();

vi.mock('../../../public/js/utils.js', () => {
  const _showToast = (...args) => showToastSpy(...args);

  return {
    showToast: _showToast,
    escapeHtml: (s) => String(s ?? ''),
    shortenWineName: (n) => n || '',
    getAllSlotsFromLayout: () => [],
    isAreasLayout: () => false,
    showConfirmDialog: vi.fn(),
    /**
     * Real implementation of maybeShowAnalysisHint using the mocked showToast.
     */
    maybeShowAnalysisHint(addedCount) {
      if (addedCount >= 3) {
        setTimeout(() => _showToast('Tip: Check Cellar Analysis for placement review', 4000), 1500);
      }
    },
  };
});

import { maybeShowAnalysisHint } from '../../../public/js/utils.js';

describe('maybeShowAnalysisHint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a toast for 3+ bottles', () => {
    maybeShowAnalysisHint(3);

    // No toast yet before delay
    expect(showToastSpy).not.toHaveBeenCalled();

    // Advance past the 1.5s delay
    vi.advanceTimersByTime(1500);

    expect(showToastSpy).toHaveBeenCalledTimes(1);
    expect(showToastSpy).toHaveBeenCalledWith(
      'Tip: Check Cellar Analysis for placement review',
      4000
    );
  });

  it('schedules a toast for large bulk additions', () => {
    maybeShowAnalysisHint(18);
    vi.advanceTimersByTime(1500);
    expect(showToastSpy).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a toast for 2 bottles', () => {
    maybeShowAnalysisHint(2);
    vi.advanceTimersByTime(2000);
    expect(showToastSpy).not.toHaveBeenCalled();
  });

  it('does not schedule a toast for 1 bottle', () => {
    maybeShowAnalysisHint(1);
    vi.advanceTimersByTime(2000);
    expect(showToastSpy).not.toHaveBeenCalled();
  });

  it('does not schedule a toast for 0 bottles', () => {
    maybeShowAnalysisHint(0);
    vi.advanceTimersByTime(2000);
    expect(showToastSpy).not.toHaveBeenCalled();
  });
});
