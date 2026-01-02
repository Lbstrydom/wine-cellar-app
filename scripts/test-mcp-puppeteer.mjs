#!/usr/bin/env node
/**
 * @fileoverview Test script for MCP Puppeteer server integration.
 * Tests navigation to Vivino and data extraction.
 *
 * Usage: node scripts/test-mcp-puppeteer.mjs
 */

import { spawn } from 'child_process';

// Simple MCP client that communicates via JSON-RPC over stdio
class SimpleMCPClient {
  constructor() {
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.buffer = '';
  }

  async connect() {
    return new Promise((resolve, reject) => {
      console.log('Starting MCP Puppeteer server...');

      this.process = spawn('npx', ['-y', 'puppeteer-mcp-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('error')) {
          console.error('Server stderr:', msg);
        }
      });

      this.process.on('error', (err) => {
        reject(new Error(`Failed to start MCP server: ${err.message}`));
      });

      // Give server time to start, then initialize
      setTimeout(async () => {
        try {
          await this.initialize();
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 3000);
    });
  }

  processBuffer() {
    // MCP uses newline-delimited JSON
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        if (response.id && this.pendingRequests.has(response.id)) {
          const { resolve, reject } = this.pendingRequests.get(response.id);
          this.pendingRequests.delete(response.id);
          if (response.error) {
            reject(new Error(response.error.message || JSON.stringify(response.error)));
          } else {
            resolve(response.result);
          }
        }
      } catch (e) {
        // Not valid JSON, might be log output
        if (line.includes('{')) {
          console.log('Non-JSON output:', line.substring(0, 100));
        }
      }
    }
  }

  async sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      const requestStr = JSON.stringify(request) + '\n';
      this.process.stdin.write(requestStr);

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 60000);
    });
  }

  async initialize() {
    console.log('Initializing MCP connection...');
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'wine-cellar-test',
        version: '1.0.0'
      }
    });
    console.log('Server capabilities:', JSON.stringify(result, null, 2));

    // Send initialized notification
    const notif = JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n';
    this.process.stdin.write(notif);

    return result;
  }

  async listTools() {
    console.log('Listing available tools...');
    const result = await this.sendRequest('tools/list', {});
    return result.tools || [];
  }

  async callTool(name, args = {}) {
    console.log(`Calling tool: ${name}`);
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args
    });
    return result;
  }

  async close() {
    if (this.process) {
      this.process.kill();
    }
  }
}

async function main() {
  const client = new SimpleMCPClient();

  try {
    // Connect to MCP server
    await client.connect();
    console.log('✓ Connected to MCP Puppeteer server\n');

    // List available tools
    const tools = await client.listTools();
    console.log('Available tools:');
    tools.forEach(tool => {
      console.log(`  - ${tool.name}: ${tool.description?.substring(0, 60) || 'No description'}...`);
    });
    console.log('');

    // Navigate to Vivino wine page
    const vivinoUrl = 'https://www.vivino.com/en/nederburg-estate-private-bin-cabernet-sauvignon/w/1160367?year=2019';
    console.log(`Navigating to: ${vivinoUrl}`);

    const navResult = await client.callTool('puppeteer_navigate', {
      url: vivinoUrl
    });
    console.log('Navigation result:', JSON.stringify(navResult, null, 2).substring(0, 500));

    // Wait for page to render (SPA needs more time)
    console.log('\nWaiting for page to render (10s for SPA)...');
    await new Promise(r => setTimeout(r, 10000));

    // Try to click cookie consent if present
    console.log('Checking for cookie consent...');
    try {
      await client.callTool('puppeteer_click', {
        selector: '[data-testid="cookie-accept-all"]'
      });
      console.log('  Clicked cookie consent');
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log('  No cookie consent found (already accepted)')
    }

    // Take a screenshot
    console.log('Taking screenshot...');
    const screenshotResult = await client.callTool('puppeteer_screenshot', {});
    // Debug: log the screenshot result structure
    console.log('Screenshot result structure:', JSON.stringify(screenshotResult, null, 2).substring(0, 300));
    if (screenshotResult?.content?.[0]?.data) {
      const fs = await import('fs');
      const screenshotPath = 'scripts/vivino-test-screenshot.png';
      fs.writeFileSync(screenshotPath, Buffer.from(screenshotResult.content[0].data, 'base64'));
      console.log(`✓ Screenshot saved to ${screenshotPath}`);
    } else {
      console.log('  Screenshot data not in expected format');
    }

    // Extract wine data using evaluate
    console.log('\nExtracting wine data...');

    // First, get the page HTML structure to understand what we're working with
    const htmlResult = await client.callTool('puppeteer_evaluate', {
      script: `document.body.innerHTML.substring(0, 3000)`
    });
    console.log('Page HTML preview:', htmlResult?.content?.[0]?.text?.substring(0, 500));

    // Get page title
    const titleResult = await client.callTool('puppeteer_evaluate', {
      script: `document.title`
    });
    console.log('Page title:', titleResult?.content?.[0]?.text);

    // Try to extract __NEXT_DATA__ which contains structured wine data
    const nextDataResult = await client.callTool('puppeteer_evaluate', {
      script: `
        const el = document.getElementById('__NEXT_DATA__');
        if (el) {
          try {
            const data = JSON.parse(el.textContent);
            return JSON.stringify({
              hasData: true,
              pageProps: data.props?.pageProps ? Object.keys(data.props.pageProps) : [],
              vintage: data.props?.pageProps?.vintage,
              wine: data.props?.pageProps?.wine
            });
          } catch(e) {
            return JSON.stringify({ error: e.message });
          }
        }
        return JSON.stringify({ hasData: false });
      `
    });
    console.log('Next.js data:', nextDataResult?.content?.[0]?.text);

    // Extract comprehensive wine data
    const wineDataResult = await client.callTool('puppeteer_evaluate', {
      script: `
        const data = {};

        // Rating
        const ratingSelectors = [
          '.vivinoRating_averageValue__uDdPM',
          '[class*="averageValue"]',
          '.average__number'
        ];
        for (const sel of ratingSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            data.rating = el.textContent.trim();
            break;
          }
        }

        // Rating count
        const countSelectors = [
          '.vivinoRating_caption__xL84P',
          '[class*="ratingCount"]',
          '[class*="caption"]'
        ];
        for (const sel of countSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent.includes('rating')) {
            data.ratingCount = el.textContent.trim();
            break;
          }
        }

        // Wine name from header
        const h1 = document.querySelector('h1');
        if (h1) data.wineName = h1.textContent.trim();

        // Winery
        const wineryEl = document.querySelector('[class*="winery"]') ||
                        document.querySelector('a[href*="/wineries/"]');
        if (wineryEl) data.winery = wineryEl.textContent.trim();

        // Region
        const regionEl = document.querySelector('[class*="location"]') ||
                        document.querySelector('a[href*="/wine-regions/"]');
        if (regionEl) data.region = regionEl.textContent.trim();

        // Grape variety
        const grapeEl = document.querySelector('[class*="grape"]') ||
                       document.querySelector('a[href*="/grapes/"]');
        if (grapeEl) data.grape = grapeEl.textContent.trim();

        // Price
        const priceEl = document.querySelector('[class*="price"]');
        if (priceEl) data.price = priceEl.textContent.trim();

        // URL
        data.url = window.location.href;

        return JSON.stringify(data, null, 2);
      `
    });

    console.log('\n=== EXTRACTED WINE DATA ===');
    try {
      const parsedText = wineDataResult?.content?.[0]?.text || '';
      // The result format is: 'Execution result:\n"<escaped JSON string>"\n\nConsole output:\n'
      // We need to extract the JSON string and unescape it
      const resultMatch = parsedText.match(/Execution result:\s*"([\s\S]*?)"\s*\n\nConsole output:/);
      if (resultMatch) {
        // Unescape the JSON string (it's escaped with \n and \")
        const unescaped = resultMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        const wineData = JSON.parse(unescaped);
        console.log(JSON.stringify(wineData, null, 2));

        // Summary
        console.log('\n=== SUMMARY ===');
        console.log(`Wine: ${wineData.wineName || 'Unknown'}`);
        console.log(`Rating: ${wineData.rating || 'N/A'}/5`);
        console.log(`Ratings Count: ${wineData.ratingCount || 'N/A'}`);
        console.log(`Winery: ${wineData.winery || 'N/A'}`);
        console.log(`Region: ${wineData.region || 'N/A'}`);
        console.log(`Grape: ${wineData.grape || 'N/A'}`);
      } else {
        console.log('Could not parse result format');
        console.log('Raw result:', parsedText);
      }
    } catch (e) {
      console.log('Parse error:', e.message);
      console.log('Raw:', wineDataResult?.content?.[0]?.text);
    }

    console.log('\n✓ MCP Puppeteer test completed successfully!');

  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
