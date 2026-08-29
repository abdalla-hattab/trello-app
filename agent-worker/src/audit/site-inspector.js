import { createHash } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { assertPublicUrl } from '../security/url-policy.js';

const clip = (value, maximum) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximum);
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

function rankLink(url, label, rules) {
  const value = `${url.pathname} ${label}`.toLowerCase();
  const ruleTerms = rules.join(' ').toLowerCase().match(/[a-z0-9\p{L}]{3,}/gu) || [];
  const known = ['product', 'collection', 'shop', 'contact', 'about', 'service', 'category'];
  return known.reduce((score, term) => score + (value.includes(term) ? 3 : 0), 0) +
    ruleTerms.reduce((score, term) => score + (value.includes(term) ? 1 : 0), 0);
}

export class SiteInspector {
  constructor(config) { this.config = config; }

  async inspect({ website, rules }) {
    const root = await assertPublicUrl(website);
    let chromium;
    try { ({ chromium } = await import('playwright')); }
    catch { throw new AppError('Playwright is not installed. Run npm install and install Chromium.', { code: 'BROWSER_NOT_INSTALLED' }); }

    const launchOptions = { headless: true, chromiumSandbox: true };
    if (this.config.browserExecutablePath) launchOptions.executablePath = this.config.browserExecutablePath;
    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      serviceWorkers: 'block',
      locale: 'en-US'
    });
    const checkedHosts = new Map();
    await context.route('**/*', async route => {
      if (route.request().resourceType() === 'media') return route.abort('blockedbyclient');
      const raw = route.request().url();
      let target;
      try { target = new URL(raw); } catch { return route.abort('blockedbyclient'); }
      if (!['http:', 'https:', 'data:', 'blob:'].includes(target.protocol)) return route.abort('blockedbyclient');
      if (['data:', 'blob:'].includes(target.protocol)) return route.continue();
      try {
        const key = `${target.protocol}//${target.hostname}`;
        if (!checkedHosts.has(key)) {
          const maximum = this.config.maxNetworkHosts || 40;
          if (checkedHosts.size >= maximum) return route.abort('blockedbyclient');
          checkedHosts.set(key, assertPublicUrl(target.toString()));
        }
        await checkedHosts.get(key);
        return route.continue();
      } catch { return route.abort('blockedbyclient'); }
    });

    const page = await context.newPage();
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    page.on('popup', popup => popup.close().catch(() => {}));
    const captures = [];
    const manifest = [];
    let totalScreenshotBytes = 0;
    const visit = async target => {
      await assertPublicUrl(target);
      let response;
      try {
        response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: this.config.browserTimeoutMs });
        await page.waitForTimeout(800);
      } catch (error) {
        throw new AppError(`The website could not be opened: ${error.message}`, { code: 'BROWSER_NAVIGATION_FAILED', retryable: true });
      }
      const finalUrl = page.url();
      await assertPublicUrl(finalUrl);
      const details = await page.evaluate(() => ({
        title: document.title,
        language: document.documentElement.lang || '',
        headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 80).map(node => ({ level: node.tagName, text: node.textContent?.trim() || '' })),
        text: document.body?.innerText || '',
        links: Array.from(document.querySelectorAll('a[href]')).slice(0, 400).map(node => ({ href: node.href, label: node.textContent?.trim() || node.getAttribute('aria-label') || '' })),
        images: Array.from(document.images).slice(0, 250).map(image => ({
          src: image.currentSrc || image.src, alt: image.alt || '', width: image.naturalWidth,
          height: image.naturalHeight, linkedTo: image.closest('a[href]')?.href || null
        })),
        forms: Array.from(document.forms).slice(0, 50).map(form => ({ action: form.action, method: form.method, controls: form.elements.length })),
        metadata: {
          description: document.querySelector('meta[name="description"]')?.content || '',
          viewport: document.querySelector('meta[name="viewport"]')?.content || ''
        }
      }));
      let screenshot = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false, animations: 'disabled' });
      if (totalScreenshotBytes + screenshot.length > this.config.maxScreenshotBytes) screenshot = null;
      if (screenshot) totalScreenshotBytes += screenshot.length;
      const pageEvidence = {
        url: finalUrl,
        status: response?.status() ?? null,
        title: clip(details.title, 500),
        language: clip(details.language, 30),
        headings: details.headings.map(item => ({ level: item.level, text: clip(item.text, 500) })).filter(item => item.text),
        text: clip(details.text, 45_000),
        links: details.links.map(item => ({ href: clip(item.href, 2048), label: clip(item.label, 300) })).filter(item => item.href),
        images: details.images.map(item => ({ ...item, src: clip(item.src, 2048), alt: clip(item.alt, 500), linkedTo: item.linkedTo ? clip(item.linkedTo, 2048) : null })),
        forms: details.forms,
        metadata: details.metadata,
        screenshotDataUrl: screenshot ? `data:image/jpeg;base64,${screenshot.toString('base64')}` : null
      };
      captures.push(pageEvidence);
      manifest.push({
        url: finalUrl, status: pageEvidence.status, title: pageEvidence.title,
        screenshot: screenshot ? { sha256: sha256(screenshot), bytes: screenshot.length, mediaType: 'image/jpeg' } : null
      });
      return pageEvidence;
    };

    try {
      const home = await visit(root.toString());
      const candidates = home.links
        .map(link => {
          try { return { url: new URL(link.href, root), label: link.label }; } catch { return null; }
        })
        .filter(item => item && item.url.origin === root.origin && ['http:', 'https:'].includes(item.url.protocol))
        .filter(item => !/(logout|signout|delete|remove|unsubscribe|admin|wp-admin)/i.test(item.url.pathname))
        .map(item => ({ ...item, score: rankLink(item.url, item.label, rules) }))
        .sort((left, right) => right.score - left.score);
      const seen = new Set([new URL(home.url).pathname]);
      for (const candidate of candidates) {
        if (captures.length >= this.config.maxAuditPages) break;
        const key = `${candidate.url.pathname}${candidate.url.search}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try { await visit(candidate.url.toString()); }
        catch (error) {
          manifest.push({ url: candidate.url.toString(), error: error.code || 'PAGE_CAPTURE_FAILED' });
        }
      }
      return { pages: captures, manifest };
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}
