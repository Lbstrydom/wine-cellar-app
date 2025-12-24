# Phase 7D: Search & Scraper Implementation Plan

**Objective:**
Fix the "blocked" rating searches (Vivino, etc.) by integrating Bright Data's Web Unlocker, removing the redundant Brave Search API, and optimizing Google Search queries for better snippet extraction.

**Target File:** `src/services/searchProviders.js`
**New Dependency:** `https-proxy-agent`

---

## 1. Environment Configuration

The "Coding LLM" must verify the `.env` file includes the Bright Data credentials and removes the unused Brave key.

**Instructions:**
1.  **Remove:** `BRAVE_SEARCH_API_KEY`
2.  **Add:** `BRIGHTDATA_PROXY_URL`

```bash
# Format: http://<Customer_ID>:<Password>@brd.superproxy.io:22225
# Ensure the "Zone" selected in Bright Data is "Web Unlocker" (for unblocking) or "ISP"
BRIGHTDATA_PROXY_URL=http://brd-customer-hl_xxxxx-zone-web_unlocker:password@brd.superproxy.io:22225
2. Dependencies
Install the proxy agent to route fetch requests through Bright Data.

Bash

npm install https-proxy-agent
3. Code Modifications (src/services/searchProviders.js)
The "Coding LLM" should perform the following refactors in src/services/searchProviders.js.

Step A: Import Proxy Agent
Add this to the top imports:

JavaScript

import { HttpsProxyAgent } from 'https-proxy-agent';
Step B: Remove Redundant Brave Search
Delete function: searchBrave(query) completely.

Update searchWineRatings: Remove the parallel call to searchBrave.

Refactor logic in searchWineRatings: From:

JavaScript

// OLD (Remove this)
const [broadResults, braveResults] = await Promise.all([
  searchGoogle(broadQuery, remainingDomains),
  searchBrave(...)
]);
To:

JavaScript

// NEW
const broadResults = remainingDomains.length > 0 
  ? await searchGoogle(broadQuery, remainingDomains)
  : [];
// const braveResults = []; // Removed
Step C: Optimize Query Generation
Force "rating" keywords for Vivino to ensure the Google snippet contains the star score.

Update buildSourceQuery:

JavaScript

function buildSourceQuery(source, wineName, vintage) {
  // CRITICAL: Force Vivino to show ratings in the search snippet
  if (source.id === 'vivino') {
    return `site:vivino.com "${wineName}" ${vintage} "stars" OR "rating"`;
  }
  
  if (source.query_template) {
    return source.query_template
      .replace('{wine}', `"${wineName}"`)
      .replace('{vintage}', vintage || '');
  }
  return `"${wineName}" ${vintage}`;
}
Step D: Implement Bright Data Unblocker in fetchPageContent
Replace the standard fetch logic with a proxy-aware fetch for blocked domains.

Replace fetchPageContent with:

JavaScript

/**
 * Fetch page content, using Bright Data Web Unlocker for blocked domains.
 */
export async function fetchPageContent(url, maxLength = 8000) {
  const domain = extractDomain(url);
  
  // Domains known to block standard scrapers
  const BLOCKED_DOMAINS = ['vivino.com', 'cellartracker.com', 'decanter.com'];
  const useUnblocker = BLOCKED_DOMAINS.some(d => domain.includes(d)) && process.env.BRIGHTDATA_PROXY_URL;

  logger.info('Fetch', `Fetching: ${url} ${useUnblocker ? '(via Bright Data)' : ''}`);

  try {
    const controller = new AbortController();
    // Give Bright Data more time (30s) as it handles challenges/rendering
    const timeout = setTimeout(() => controller.abort(), useUnblocker ? 30000 : 10000);

    const fetchOptions = {
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    };

    // Attach Proxy Agent if needed
    if (useUnblocker) {
      fetchOptions.agent = new HttpsProxyAgent(process.env.BRIGHTDATA_PROXY_URL);
      // Bright Data handles user-agents, so we can omit or simplify ours to avoid conflicts
      // Note: "rejectUnauthorized: false" is sometimes needed for proxies, but try standard first
    } else {
      // Standard headers for direct fetch
      fetchOptions.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeout);

    // ... [Rest of the existing HTML processing logic remains the same] ...
    // ... [Ensure you keep the Vivino JSON extraction logic!] ...
    
    // existing logic...
    const status = response.status;
    if (!response.ok) { 
        // ... error handling 
    }
    const html = await response.text();
    // ... extraction logic
    return { content: text.substring(0, maxLength), success: true, ... };

  } catch (error) {
    // ... existing error handling
  }
}
Step E: Remove Dead Code
Remove fetchAuthenticatedRatings and fetchVivinoAuthenticated. The Web Unlocker approach makes "logging in" unnecessary and risky. We will rely on reading the public Vivino page via the Unblocker.

4. Verification Checklist
Environment: BRIGHTDATA_PROXY_URL is set in .env.

Clean Code: searchBrave is gone. fetchAuthenticatedRatings is gone.

Search Logic: buildSourceQuery includes the specific Vivino override.

Fetch Logic: fetchPageContent instantiates HttpsProxyAgent when it detects vivino.com.