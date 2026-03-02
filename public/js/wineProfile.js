/**
 * @fileoverview Wine Profile section renderer for the wine detail modal.
 * Displays the AI-generated prose narrative from unified wine search.
 *
 * SECURITY: All LLM output is rendered via DOM creation (textContent),
 * never via innerHTML. This prevents XSS from prompt-injected web content.
 * @module wineProfile
 */

/**
 * Render the wine profile narrative section into a container.
 * Hides the container if no narrative is available.
 * @param {HTMLElement} container - Container element to render into
 * @param {string|null} narrative - Prose narrative from unified wine search
 */
export function renderWineProfile(container, narrative) {
  if (!container) return;

  if (!narrative || !narrative.trim()) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  // Build collapsible section entirely via DOM creation (no innerHTML with LLM content)
  const section = document.createElement('div');
  section.className = 'wine-profile-section';

  // Toggle button (header)
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'wine-profile-toggle';
  toggle.setAttribute('aria-expanded', 'false');

  const titleSpan = document.createElement('span');
  titleSpan.textContent = 'Wine Profile';
  toggle.appendChild(titleSpan);

  const chevron = document.createElement('span');
  chevron.className = 'wine-profile-chevron';
  chevron.textContent = '▶';
  chevron.setAttribute('aria-hidden', 'true');
  toggle.appendChild(chevron);

  // Collapsible body
  const body = document.createElement('div');
  body.className = 'wine-profile-body';
  body.style.display = 'none';
  body.setAttribute('aria-hidden', 'true');
  body.appendChild(renderNarrative(narrative));

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    body.style.display = expanded ? 'none' : 'block';
    body.setAttribute('aria-hidden', String(expanded));
    chevron.textContent = expanded ? '▶' : '▼';
  });

  section.appendChild(toggle);
  section.appendChild(body);

  container.innerHTML = '';
  container.appendChild(section);
}

/**
 * Convert markdown narrative text to safe DOM nodes.
 * Handles: # headings, **bold**, *italic*, - bullet lists, plain paragraphs.
 * All text is set via textContent — no innerHTML with untrusted content.
 * @param {string} text - Markdown narrative from Claude
 * @returns {DocumentFragment}
 */
function renderNarrative(text) {
  const fragment = document.createDocumentFragment();
  const lines = text.split('\n');

  let currentList = null;
  let paragraphLines = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const raw = paragraphLines.join(' ').trim();
    if (raw) {
      const p = document.createElement('p');
      p.className = 'wine-profile-para';
      renderInline(p, raw);
      fragment.appendChild(p);
    }
    paragraphLines = [];
  };

  const flushList = () => {
    if (currentList) {
      fragment.appendChild(currentList);
      currentList = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Blank line: flush accumulated blocks
    if (trimmed === '') {
      flushParagraph();
      flushList();
      continue;
    }

    // Headings: ##, ###, ####
    if (/^#{1,4}\s+/.test(trimmed)) {
      flushParagraph();
      flushList();
      const level = (trimmed.match(/^(#+)/) || ['', ''])[1].length;
      const tag = level <= 2 ? 'h3' : 'h4';
      const heading = document.createElement(tag);
      heading.className = 'wine-profile-heading';
      heading.textContent = trimmed.replace(/^#+\s+/, '');
      fragment.appendChild(heading);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      fragment.appendChild(document.createElement('hr'));
      continue;
    }

    // Bullet list items: - or *
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      if (!currentList) {
        currentList = document.createElement('ul');
        currentList.className = 'wine-profile-list';
      }
      const li = document.createElement('li');
      renderInline(li, trimmed.replace(/^[-*]\s+/, ''));
      currentList.appendChild(li);
      continue;
    }

    // Regular paragraph text — accumulate and flush on blank line
    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return fragment;
}

/**
 * Render inline markdown (bold, italic) into a parent element using DOM nodes.
 * Split on **bold** and *italic* markers; all text set via textContent.
 * @param {HTMLElement} el - Parent element
 * @param {string} text - Text with possible inline markdown
 */
function renderInline(el, text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      el.appendChild(strong);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      const em = document.createElement('em');
      em.textContent = part.slice(1, -1);
      el.appendChild(em);
    } else if (part) {
      el.appendChild(document.createTextNode(part));
    }
  }
}
