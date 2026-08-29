import { SiteInspector } from '../src/audit/site-inspector.js';

const website = process.argv[2] || 'https://example.com/';
const inspector = new SiteInspector({
  browserTimeoutMs: 30_000,
  maxAuditPages: 2,
  maxScreenshotBytes: 2_000_000
});

const inspection = await inspector.inspect({
  website,
  rules: ['The page loads successfully', 'The page has a clear primary heading']
});

const summary = {
  website,
  pagesCaptured: inspection.pages.length,
  pages: inspection.pages.map(page => ({
    url: page.url,
    status: page.status,
    title: page.title,
    headings: page.headings.length,
    links: page.links.length,
    images: page.images.length,
    screenshotCaptured: Boolean(page.screenshotDataUrl)
  })),
  manifest: inspection.manifest
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
