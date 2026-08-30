import { createHash } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { assertPublicUrl } from '../security/url-policy.js';

const clip = (value, maximum) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximum);
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

function rankLink(url, label, rules) {
  const value = `${url.pathname} ${label}`.toLowerCase();
  const ruleTerms = rules.join(' ').toLowerCase().match(/[a-z0-9\p{L}]{3,}/gu) || [];
  const known = ['product', 'products', 'collection', 'shop', 'category', 'catalog', 'منتج', 'منتجات', 'تصنيف'];
  return known.reduce((score, term) => score + (value.includes(term) ? 3 : 0), 0) +
    ruleTerms.reduce((score, term) => score + (value.includes(term) ? 1 : 0), 0);
}

function inspectionPlan(config, skills) {
  const exhaustive = (skills || []).filter(skill => skill.scopeMode !== 'sample');
  if (!exhaustive.length) return { mode: 'sample', maximumPages: config.maxAuditPages };
  const mode = exhaustive.some(skill => skill.scopeMode === 'all_discovered_pages')
    ? 'all_discovered_pages'
    : 'all_product_pages';
  const requested = Math.max(...exhaustive.map(skill => skill.maximumPages || config.maxSkillPages));
  return { mode, maximumPages: Math.min(config.maxSkillPages, requested) };
}

function normalizedInternalLink(raw, root) {
  try {
    const url = new URL(raw, root);
    if (url.origin !== root.origin || !['http:', 'https:'].includes(url.protocol)) return null;
    if (/(logout|signout|delete|remove|unsubscribe|admin|wp-admin|cart|checkout|account|login|register)/i.test(url.pathname)) return null;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|xml)$/i.test(url.pathname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid|ref|source)/i.test(key)) url.searchParams.delete(key);
    }
    return url;
  } catch { return null; }
}

function xmlLocations(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(match => match[1]
    .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').trim());
}

async function fetchPublicText(rawUrl, timeoutMs) {
  let current = new URL(rawUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await assertPublicUrl(current.toString());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current, {
        redirect: 'manual', signal: controller.signal,
        headers: { 'User-Agent': 'MasaratWebsiteAgent/1.0 read-only-audit' }
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        current = new URL(response.headers.get('location'), current);
        continue;
      }
      if (!response.ok) return '';
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 3_000_000) return '';
      const text = await response.text();
      return text.slice(0, 3_000_000);
    } catch { return ''; }
    finally { clearTimeout(timer); }
  }
  return '';
}

async function sitemapLinks(root, mode, maximumPages, timeoutMs) {
  if (mode === 'sample') return [];
  const sitemapUrl = new URL('/sitemap.xml', root);
  const rootXml = await fetchPublicText(sitemapUrl, timeoutMs);
  if (!rootXml) return [];
  const first = xmlLocations(rootXml).map(value => normalizedInternalLink(value, root)).filter(Boolean);
  const sitemapDocuments = first.filter(url => /\.xml(?:$|\?)/i.test(url.pathname + url.search));
  const directPages = first.filter(url => !/\.xml(?:$|\?)/i.test(url.pathname + url.search));
  const productDocuments = sitemapDocuments.filter(url => /product|منتج/i.test(url.pathname));
  const selectedDocuments = mode === 'all_product_pages'
    ? (productDocuments.length ? productDocuments : sitemapDocuments).slice(0, 12)
    : sitemapDocuments.slice(0, 12);
  const pages = [...directPages];
  for (const documentUrl of selectedDocuments) {
    const xml = await fetchPublicText(documentUrl, timeoutMs);
    for (const value of xmlLocations(xml)) {
      const url = normalizedInternalLink(value, root);
      if (url) pages.push(url);
      if (pages.length >= maximumPages * 3) break;
    }
    if (pages.length >= maximumPages * 3) break;
  }
  return pages;
}

export class SiteInspector {
  constructor(config) { this.config = config; }

  async inspect({ website, rules, skills = [] }) {
    const root = await assertPublicUrl(website);
    const plan = inspectionPlan(this.config, skills);
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
          viewport: document.querySelector('meta[name="viewport"]')?.content || '',
          type: document.querySelector('meta[property="og:type"]')?.content || ''
        },
        structuredTypes: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap(node => {
          try {
            const value = JSON.parse(node.textContent || 'null');
            const items = Array.isArray(value) ? value : value?.['@graph'] || [value];
            return items.flatMap(item => Array.isArray(item?.['@type']) ? item['@type'] : item?.['@type'] ? [item['@type']] : []);
          } catch { return []; }
        }).slice(0, 40),
        hasProductMicrodata: Boolean(document.querySelector('[itemtype*="schema.org/Product"], [itemtype$="/Product"]'))
      }));
      let screenshot = captures.length < this.config.maxAuditPages
        ? await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false, animations: 'disabled' })
        : null;
      if (screenshot && totalScreenshotBytes + screenshot.length > this.config.maxScreenshotBytes) screenshot = null;
      if (screenshot) totalScreenshotBytes += screenshot.length;
      const pageEvidence = {
        url: finalUrl,
        status: response?.status() ?? null,
        title: clip(details.title, 500),
        language: clip(details.language, 30),
        headings: details.headings.slice(0, plan.mode === 'sample' ? 80 : 30).map(item => ({ level: item.level, text: clip(item.text, 500) })).filter(item => item.text),
        text: clip(details.text, plan.mode === 'sample' ? 45_000 : 3_500),
        links: details.links.slice(0, plan.mode === 'sample' ? 400 : 40).map(item => ({ href: clip(item.href, 2048), label: clip(item.label, 300) })).filter(item => item.href),
        images: details.images.slice(0, plan.mode === 'sample' ? 250 : 30).map(item => ({ ...item, src: clip(item.src, 2048), alt: clip(item.alt, 500), linkedTo: item.linkedTo ? clip(item.linkedTo, 2048) : null })),
        forms: details.forms,
        metadata: details.metadata,
        pageTypes: details.structuredTypes.map(value => clip(value, 100)),
        isProductPage: details.hasProductMicrodata || details.structuredTypes.some(value => String(value).toLowerCase() === 'product') ||
          /(?:\/products?\/|\/p\/|\/p\d+|\/product-)/i.test(new URL(finalUrl).pathname) || String(details.metadata.type).toLowerCase() === 'product',
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
      const seen = new Set([new URL(home.url).toString()]);
      const queued = new Set();
      const candidates = [];
      const enqueue = links => {
        for (const link of links) {
          const url = normalizedInternalLink(link.href, root);
          if (!url) continue;
          const key = url.toString();
          if (seen.has(key) || queued.has(key)) continue;
          if (seen.size + queued.size >= plan.maximumPages * 30) break;
          queued.add(key);
          candidates.push({ url, label: link.label, score: rankLink(url, link.label, rules) });
        }
        candidates.sort((left, right) => right.score - left.score);
      };
      const sitemapCandidates = await sitemapLinks(root, plan.mode, plan.maximumPages, this.config.browserTimeoutMs);
      enqueue(sitemapCandidates.map(url => ({ href: url.toString(), label: plan.mode === 'all_product_pages' ? 'product sitemap' : 'website sitemap' })));
      enqueue(home.links);
      while (candidates.length && captures.length < plan.maximumPages) {
        const candidate = candidates.shift();
        const key = candidate.url.toString();
        queued.delete(key);
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const captured = await visit(key);
          if (plan.mode !== 'sample') enqueue(captured.links);
        } catch (error) {
          manifest.push({ url: key, error: error.code || 'PAGE_CAPTURE_FAILED' });
        }
      }
      const productPages = captures.filter(item => item.isProductPage).length;
      return {
        pages: captures,
        manifest,
        coverage: {
          mode: plan.mode,
          safetyLimit: plan.maximumPages,
          discoveredUrls: seen.size + queued.size,
          visitedPages: captures.length,
          productPages,
          truncated: candidates.length > 0 && captures.length >= plan.maximumPages
        }
      };
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}
