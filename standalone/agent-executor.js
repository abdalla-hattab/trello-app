/**
 * Isolated, per-store agent checker. No app state or credentials are read/written.
 * app.js calls window.startAgentExecution(cardData, agentDescription, agentRules).
 * Markup/styles live in a shadow root; the native dialog handles modal focus.
 *
 * SETUP: point AGENT_API_URL at the authenticated agent-worker API.
 * Optional runtime override:
 * window.AGENT_EXECUTOR_CONFIG = { apiUrl, timeoutMs, getAccessToken: async () => "short-lived-token" }.
 * Never put AI keys or permanent authentication secrets in this frontend file.
 *
 * POST application/json (only these fields are sent, never the full card):
 * {
 *   "requestId": "unique-run-id",
 *   "storeId": "stable-store-id",
 *   "storeName": "Store name",
 *   "website": "https://store.example/",
 *   "agentDescription": "You are a website QA checker...",
 *   "agentRules": ["The add-to-cart button is visible", "The checkout opens"],
 *   "ruleIds": ["rule-1", "rule-2"]
 * }
 *
 * Expected JSON response (ruleIds may arrive in any order):
 * {
 *   "requestId": "same-request-id",
 *   "results": [
 *     { "ruleId": "rule-1", "score": 99, "explanation": "The button is visible." },
 *     { "ruleId": "rule-2", "score": 65, "explanation": "Checkout returned an error.", "recommendation": "Repair the checkout link." }
 *   ]
 * }
 * A numeric score must be between 0 and 100. It determines the rule's grade:
 * 97–100 green, 70–<97 yellow, <70 red. The overall score is an equal-weight
 * average, shown ONLY when every requested rule has a valid score. It measures
 * this configured checklist, not an exhaustive audit of the entire website.
 * Legacy passed: true/false is supported as 100/0 when score is absent. An
 * explicitly invalid/null score is never replaced by a guessed score. The UI
 * explains binary scoring. Use score: null for a check that could not run.
 * Missing scores are shown as "No result". A plain results array is also accepted;
 * without ruleIds it MUST contain one result per rule, in the original order.
 *
 * The production service may return a completed report immediately or a queued
 * job with { jobId, statusUrl, status }. This UI polls the same authenticated
 * origin until the durable worker completes. Aborting fetch only stops this
 * browser waiting; it does not cancel a worker job. AI/database secrets belong
 * on the worker, never in this frontend file.
 */
(() => {
    'use strict';

    const AGENT_API_URL = 'https://YOUR-AGENT-HOST/v1/checks';
    const REQUEST_TIMEOUT_MS = 300000;
    const SCORE_THRESHOLDS = { green: 97, yellow: 70 };
    let activeRun = null;

    const STYLES = `
        :host { color-scheme: light; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        *, *::before, *::after { box-sizing: border-box; }
        dialog {
            padding: 0; border: 1px solid #e4e8ec; border-radius: 24px; margin: auto;
            width: min(1400px, calc(100vw - 40px)); max-width: none;
            height: min(1000px, calc(100vh - 40px)); height: min(1000px, calc(100dvh - 40px)); max-height: none;
            color: #16221e; background: #fff; overflow: hidden;
            box-shadow: 0 30px 100px #0f172a4d, 0 4px 20px #0f172a14;
        }
        dialog::backdrop { background: #101a27b3; backdrop-filter: blur(9px); }
        .frame { display: flex; flex-direction: column; height: 100%; }
        button, a, summary { -webkit-tap-highlight-color: transparent; }
        button { font: inherit; cursor: pointer; }
        button:focus-visible, a:focus-visible, summary:focus-visible { outline: 3px solid #10b981; outline-offset: 4px; }
        [hidden] { display: none !important; }
        .header { padding: 22px 32px; flex-shrink: 0; display: flex; align-items: center; gap: 14px; border-bottom: 1px solid #edf0ee; }
        .brand { width: 42px; height: 42px; flex-shrink: 0; border: 1px solid #ddede5; border-radius: 13px; background: #f0f9f4; color: #168652; display: grid; place-items: center; }
        .heading { flex: 1; min-width: 0; }
        .eyebrow { display: block; color: #819087; font-size: 10px; font-weight: 650; letter-spacing: .16em; margin: 0 0 6px; }
        h1 { font-size: 19px; font-weight: 650; line-height: 1.4; letter-spacing: -.4px; margin: 0; overflow-wrap: anywhere; }
        .website { color: #64748b; font-size: 12px; line-height: 1.5; text-decoration: none; overflow-wrap: anywhere; }
        a.website:hover { color: #047857; text-decoration: underline; }
        .close { flex-shrink: 0; display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #64748b; font-size: 22px; line-height: 1; }
        .close:hover { background: #f1f5f9; color: #172b4d; }
        .header-meta { display: flex; align-items: center; gap: 22px; margin-right: 8px; }
        .run-badge { font-size: 11px; color: #69776f; display: flex; align-items: center; gap: 7px; white-space: nowrap; }
        .run-badge::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #aab5ae; }
        [data-phase="checking"] .run-badge::before { background: #199f61; animation: pulse 1.5s ease-in-out infinite; }
        [data-phase="complete"] .run-badge::before { background: #199f61; }
        .content { flex: 1; overflow-y: auto; overscroll-behavior: contain; min-height: 0; padding: 26px 32px 36px; background: #fff; }
        .intro { margin-bottom: 24px; }
        .status-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
        .status-title { margin: 0; font-size: 25px; line-height: 1.35; font-weight: 600; letter-spacing: -.8px; }
        .elapsed { color: #64748b; font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .status-detail { margin: 0; color: #78847c; font-size: 12px; line-height: 1.65; }
        .workspace { display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 26px; align-items: start; }
        .overview { border: 1px solid #e5ebe7; border-radius: 18px; padding: 24px 20px; text-align: center; background: #fcfdfc; position: sticky; top: 0; }
        .overview h2 { font-size: 11px; font-weight: 650; letter-spacing: .12em; margin: 0 0 17px; color: #748077; text-transform: uppercase; }
        .gauge { --tone: #b4bfb8; position: relative; width: 224px; height: 224px; margin: 0 auto; flex-shrink: 0; }
        .gauge[data-tone="green"] { --tone: #17aa68; } .gauge[data-tone="yellow"] { --tone: #d8a00a; } .gauge[data-tone="red"] { --tone: #e15c55; }
        .gauge svg { width: 100%; height: 100%; display: block; overflow: visible; }
        .gauge-track { fill: none; stroke: #eaf0ec; stroke-width: 6; }
        .gauge-ticks { fill: none; stroke: #d8e2db; stroke-width: 1; stroke-dasharray: .4 3.6; }
        .gauge-fill { fill: none; stroke: var(--tone); stroke-width: 6; stroke-linecap: round; stroke-dasharray: 100; stroke-dashoffset: 100; transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset .8s cubic-bezier(.22,1,.36,1), stroke .3s; }
        .gauge[data-scanning="true"] .gauge-fill { stroke: #19a56a; stroke-dasharray: 18 82; stroke-dashoffset: 0; animation: orbit 2s linear infinite; }
        .gauge-center { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; }
        .gauge-value { font-size: 61px; letter-spacing: -4px; font-weight: 550; line-height: 1.1; font-variant-numeric: tabular-nums; }
        .gauge-unit { color: #8c968f; font-size: 11px; margin-top: 6px; }
        .score-grade { display: inline-block; margin: 16px 0 10px; padding: 6px 12px; border-radius: 20px; background: #edf1ee; color: #6b7870; font-size: 11px; font-weight: 600; }
        .score-grade[data-tone="green"] { background: #e8f7ee; color: #18834f; } .score-grade[data-tone="yellow"] { background: #fff6d9; color: #8f6908; } .score-grade[data-tone="red"] { background: #fceceb; color: #b3443e; }
        .score-context { font-size: 12px; color: #79857d; line-height: 1.65; margin: 0 0 22px; }
        .score-scale { border-top: 1px solid #e5ebe7; padding-top: 16px; display: grid; gap: 12px; text-align: left; }
        .scale-row { display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #7a877e; gap: 8px; }
        .scale-row span:first-child { display: flex; gap: 8px; align-items: center; color: #4e5f54; }
        .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
        .green { background: #17aa68; } .yellow { background: #d8a00a; } .red { background: #e15c55; }
        .method-note { font-size: 10px; color: #8a958e; line-height: 1.7; margin: 18px 0 0; }
        .report-body { min-width: 0; }
        .scan-panel { border: 1px solid #e5ebe7; border-radius: 16px; padding: 20px; display: flex; align-items: center; gap: 24px; background: #fafcfb; }
        .scan-art { width: 150px; height: 115px; flex-shrink: 0; border-radius: 12px; background: #eef4f0; display: grid; place-items: center; overflow: hidden; }
        .scan-browser { position: relative; width: 112px; height: 81px; border: 1px solid #dce6df; border-radius: 7px; background: #fff; box-shadow: 0 5px 15px #1d523e09; overflow: hidden; }
        .browser-bar { height: 15px; border-bottom: 1px solid #edf1ee; display: flex; align-items: center; gap: 3px; padding-left: 7px; }
        .browser-bar i { width: 3px; height: 3px; border-radius: 100%; background: #c7d5cc; }
        .browser-hero { height: 22px; margin: 8px; border-radius: 3px; background: #eaf2ed; }
        .browser-cards { display: flex; margin: 0 8px; gap: 4px; } .browser-cards i { flex: 1; height: 18px; background: #f0f4f1; border-radius: 3px; }
        .scan-line { display: none; position: absolute; inset: 0 0 auto; height: 2px; background: #17aa68; box-shadow: 0 0 14px #17aa6855; }
        [data-phase="checking"] .scan-line { display: block; animation: scan 2.2s ease-in-out infinite; }
        .scan-text { flex: 1; min-width: 0; }
        .scan-heading { font-size: 15px; line-height: 1.4; font-weight: 600; margin: 0 0 7px; }
        .scan-copy { font-size: 11px; line-height: 1.65; color: #7b887f; margin: 0; }
        .scan-caption { color: #94a098; font-size: 9px; margin: 10px 0 0; }
        [data-phase="complete"] .scan-panel, [data-phase="incomplete"] .scan-panel { padding: 14px 18px; }
        [data-phase="complete"] .scan-art, [data-phase="complete"] .scan-caption, [data-phase="complete"] .stages,
        [data-phase="incomplete"] .scan-art, [data-phase="incomplete"] .scan-caption, [data-phase="incomplete"] .stages { display: none; }
        .stages { display: flex; align-items: center; gap: 8px; margin-top: 15px; }
        .stage { font-size: 10px; color: #98a49b; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
        .stage i { width: 17px; height: 17px; display: grid; place-items: center; border-radius: 50%; font-style: normal; border: 1px solid #d9e3dc; font-size: 9px; }
        .stage[data-state="done"], .stage[data-state="active"] { color: #168451; } .stage[data-state="done"] i { background: #e1f3e8; border-color: #c3e7d1; }
        .stage[data-state="active"] i { border-color: #16a766; animation: pulse 1.5s ease-in-out infinite; }
        .stage-line { height: 1px; background: #e0e8e3; width: 16px; }
        .progress { height: 3px; background: #edf2ef; border-radius: 20px; overflow: hidden; margin: 14px 0 20px; }
        .progress-fill { width: 0; height: 100%; border-radius: inherit; background: #10b981; transition: width .25s ease; }
        .progress[data-running="true"] .progress-fill { width: 35%; background: linear-gradient(90deg, #a7f3d0, #10b981); animation: sweep 1.65s ease-in-out infinite; }
        .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
        .stat { padding: 14px 17px; border: 1px solid #e5ebe7; border-radius: 12px; background: #fff; }
        .stat strong { font-size: 26px; font-weight: 550; display: block; margin-bottom: 5px; font-variant-numeric: tabular-nums; }
        .stat span { font-size: 11px; color: #64748b; }
        .stat-pass strong { color: #168451; } .stat-fail strong { color: #b48613; } .stat-unknown strong { color: #79857d; }
        .notice { border: 1px solid #fde68a; background: #fffbeb; color: #854d0e; border-radius: 12px; padding: 13px 15px; margin: 0 0 18px; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; white-space: pre-line; }
        .rules-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 0 0 10px; }
        .rules-heading h2 { font-size: 15px; font-weight: 600; margin: 0; letter-spacing: -.3px; }
        .rule-count { background: #f1f5f9; color: #64748b; border-radius: 6px; padding: 3px 7px; font-size: 10px; }
        ol { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .rule { padding: 19px; border: 1px solid #e5ebe7; border-radius: 14px; background: #fff; min-width: 0; }
        .rule[data-tone="yellow"] { border-color: #eedeac; } .rule[data-tone="red"] { border-color: #efd1cd; }
        .rule-icon { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; background: #f1f5f9; color: #94a3b8; font-size: 11px; line-height: 1; font-weight: 700; }
        .rule[data-state="passed"] .rule-icon { color: #047857; background: #d1fae5; }
        .rule[data-state="failed"] .rule-icon { color: #dc2626; background: #fee2e2; }
        .rule[data-state="unknown"] .rule-icon { color: #a16207; background: #fef3c7; }
        .rule[data-state="checking"] .rule-icon::after { content: ""; width: 12px; height: 12px; border: 2px solid #a7f3d0; border-top-color: #059669; border-radius: 50%; animation: spin .8s linear infinite; }
        .rule-body { flex: 1; min-width: 0; }
        .rule-top { display: flex; justify-content: space-between; align-items: center; gap: 14px; }
        .rule-number { font-size: 9px; font-weight: 600; color: #9aa59e; letter-spacing: .12em; margin-bottom: 7px; }
        .rule-name { font-size: 12px; font-weight: 550; line-height: 1.6; margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
        .rule-state { display: flex; align-items: center; gap: 6px; margin-top: 11px; }
        .rule-status { font-size: 10px; font-weight: 550; color: #7a877f; line-height: 1.6; }
        .rule[data-state="checking"] .rule-status, .rule[data-state="passed"] .rule-status { color: #047857; }
        .rule[data-tone="red"] .rule-status { color: #bc524a; }
        .rule[data-tone="yellow"] .rule-status { color: #a5790a; }
        .rule[data-tone="yellow"] .rule-icon { color: #a5790a; background: #fff4cd; }
        .rule[data-state="unknown"] .rule-status { color: #a16207; }
        .explanation { font-size: 11px; color: #7b887f; line-height: 1.7; margin: 12px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
        .gauge-small { width: 62px; height: 62px; margin: 0; } .gauge-small .gauge-value { font-size: 18px; letter-spacing: -.7px; font-weight: 600; }
        .gauge-small .gauge-unit { font-size: 8px; margin-top: 1px; } .gauge-small .gauge-ticks { display: none; }
        .recommendation { margin: 10px 0 0; font-size: 11px; line-height: 1.6; color: #62766a; background: #f6f8f6; padding: 9px 11px; border-radius: 8px; overflow-wrap: anywhere; white-space: pre-wrap; }
        .evidence { margin-top: 10px; color: #5e6f65; font-size: 10px; line-height: 1.6; }
        .evidence summary { width: max-content; color: #387158; font-weight: 650; cursor: pointer; }
        .evidence ul { margin: 8px 0 0; padding-inline-start: 18px; }
        .evidence li { margin-top: 4px; overflow-wrap: anywhere; white-space: pre-wrap; }
        .feedback { margin-top: 13px; padding-top: 12px; border-top: 1px solid #edf1ee; }
        .feedback-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .feedback button, .teach-box button { border: 1px solid #dce5df; border-radius: 8px; background: #fff; color: #526158; padding: 7px 10px; font: inherit; font-size: 10px; font-weight: 600; }
        .feedback button:hover, .teach-box button:hover { background: #f3f8f5; }
        .feedback button:disabled, .teach-box button:disabled { cursor: wait; opacity: .55; }
        .correction { margin-top: 10px; display: grid; grid-template-columns: minmax(0,1fr) 95px; gap: 8px; }
        .correction textarea, .teach-box textarea { resize: vertical; min-height: 70px; width: 100%; border: 1px solid #dce5df; border-radius: 9px; padding: 9px 10px; font: inherit; font-size: 11px; color: #25332b; background: #fff; }
        .correction input { width: 100%; border: 1px solid #dce5df; border-radius: 9px; padding: 9px; font: inherit; font-size: 11px; }
        .correction-buttons { grid-column: 1 / -1; display: flex; gap: 8px; }
        .feedback-status, .teach-status { margin: 8px 0 0; color: #65746b; font-size: 10px; line-height: 1.5; }
        .teach-box { margin-top: 22px; border: 1px solid #dce9e0; border-radius: 14px; padding: 18px; background: #fafcfb; }
        .teach-box h3 { margin: 0 0 5px; font-size: 14px; }
        .teach-box p { color: #758178; font-size: 11px; line-height: 1.6; margin: 0 0 11px; }
        .teach-controls { display: flex; gap: 9px; align-items: flex-end; }
        .teach-controls textarea { flex: 1; }
        .insights-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 22px; }
        .insight { border-radius: 14px; border: 1px solid #e5ebe7; padding: 18px; min-width: 0; }
        .insight h3 { font-size: 12px; font-weight: 600; margin: 0 0 11px; display: flex; align-items: center; gap: 7px; }
        .insight ul { margin: 0; padding-left: 15px; display: grid; gap: 9px; color: #728077; font-size: 11px; line-height: 1.65; }
        .insight-empty { color: #8a958f; font-size: 11px; line-height: 1.7; margin: 0; }
        .empty { color: #64748b; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; font-size: 12px; line-height: 1.7; }
        details { margin-top: 18px; border-top: 1px solid #eef2f6; padding-top: 15px; }
        summary { cursor: pointer; color: #64748b; font-size: 11px; font-weight: 550; }
        .persona { color: #64748b; font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; margin-bottom: 0; }
        .footer { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 32px; border-top: 1px solid #e5ebe7; background: #fcfdfc; }
        .footnote { margin: 0; font-size: 10px; color: #8b968f; line-height: 1.65; max-width: 660px; }
        .actions { display: flex; gap: 8px; flex-shrink: 0; }
        .button { border: 1px solid #dbe3ec; border-radius: 9px; padding: 10px 14px; font-size: 12px; font-weight: 600; background: #fff; color: #475569; }
        .button:hover { background: #f1f5f9; }
        .primary { background: #059669; border-color: #059669; color: #fff; box-shadow: 0 2px 3px #04785715; }
        .primary:hover { background: #047857; border-color: #047857; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes orbit { to { transform: rotate(270deg); } }
        @keyframes pulse { 50% { opacity: .35; } }
        @keyframes scan { 0%, 100% { top: 15px; } 50% { top: 79px; } }
        @keyframes sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(390%); } }
        @media (max-width: 1000px) {
            .workspace { grid-template-columns: 235px minmax(0, 1fr); gap: 18px; }
            .overview { padding: 20px 16px; } .gauge-large { width: 195px; height: 195px; }
            .scan-art { width: 100px; } .scan-panel { gap: 14px; padding: 16px; }
            .scan-browser { width: 86px; } .rule { padding: 15px; }
        }
        @media (max-height: 800px) { .overview { position: static; } }
        @media (max-width: 800px) {
            .workspace { grid-template-columns: 1fr; } .overview { position: static; }
            .header-meta .website { display: none; } .header-meta { margin-left: auto; gap: 0; }
            .score-scale { max-width: 310px; margin: 0 auto; } .method-note { margin-left: auto; margin-right: auto; max-width: 350px; }
            .gauge-large { width: 200px; height: 200px; } .score-context { margin-bottom: 16px; }
        }
        @media (max-width: 520px) {
            dialog { width: calc(100vw - 16px); height: calc(100dvh - 16px); border-radius: 16px; }
            .header { padding: 20px 18px; gap: 12px; } .brand { width: 40px; height: 40px; border-radius: 12px; }
            h1 { font-size: 16px; } .content { padding: 18px; } .stat { padding: 12px; } .status-title { font-size: 22px; }
            .run-badge { display: none; } .header-meta { display: none; } .heading { overflow: hidden; }
            .header .eyebrow { font-size: 8px; } .scan-art { display: none; }
            ol, .insights-grid { grid-template-columns: 1fr; } .rule-top { align-items: flex-start; }
            .footer { padding: 15px 18px; flex-wrap: wrap; gap: 12px; } .actions { margin-left: auto; }
            .footnote { max-width: none; } .rule { padding: 18px; }
            .teach-controls { display: grid; } .correction { grid-template-columns: 1fr; }
            .correction-buttons { grid-column: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation: none !important; transition: none !important; }
            .progress[data-running="true"] .progress-fill { width: 100%; opacity: .45; }
        }
    `;

    function normalizeWebsite(value) {
        const text = typeof value === 'string' ? value.trim() : '';
        if (!text || /\s/.test(text)) throw new Error('Add a valid website to this store before running its agent.');
        let url;
        try { url = new URL(text.includes('://') ? text : `https://${text}`); }
        catch (_) { throw new Error('This store has an invalid website. Use a URL such as https://store.com.'); }
        if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
            throw new Error('The store website must be an HTTP or HTTPS URL without embedded credentials.');
        }
        return url.href;
    }

    function normalizeStoreId(title, website) {
        const source = `${typeof title === 'string' ? title : ''}|${typeof website === 'string' ? website : ''}`;
        let hash = 2166136261;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `store-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    function normalizeRuleIds(rules) {
        const occurrences = new Map();
        return rules.map(rule => {
            let hash = 2166136261;
            for (let index = 0; index < rule.length; index += 1) {
                hash ^= rule.charCodeAt(index);
                hash = Math.imul(hash, 16777619);
            }
            const base = `rule-${(hash >>> 0).toString(16).padStart(8, '0')}`;
            const count = (occurrences.get(base) || 0) + 1;
            occurrences.set(base, count);
            return count === 1 ? base : `${base}-${count}`;
        });
    }

    async function getConfig() {
        const overrides = window.AGENT_EXECUTOR_CONFIG || {};
        const endpoint = typeof overrides.apiUrl === 'string'
            ? overrides.apiUrl.trim()
            : typeof overrides.webhookUrl === 'string'
                ? overrides.webhookUrl.trim()
                : AGENT_API_URL;
        if (!endpoint || /YOUR-AGENT-HOST/i.test(endpoint)) {
            throw new Error('The agent service has not been connected yet. Configure its authenticated API URL before running a real check. No request has been sent.');
        }
        let url;
        try { url = new URL(endpoint); }
        catch (_) { throw new Error('The configured agent API URL is invalid. Enter its full HTTPS URL.'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
            throw new Error('Use an HTTP or HTTPS agent API URL without embedded credentials or a fragment.');
        }
        if (window.location.protocol === 'https:' && url.protocol !== 'https:') {
            throw new Error('This app uses HTTPS, so the agent API must use HTTPS too.');
        }
        const getAccessToken = typeof overrides.getAccessToken === 'function' ? overrides.getAccessToken : null;
        let accessToken = typeof overrides.accessToken === 'string' ? overrides.accessToken.trim() : '';
        if (getAccessToken) accessToken = String(await getAccessToken() || '').trim();
        if (!accessToken) throw new Error('Secure agent sign-in has not been connected. No request has been sent.');
        const timeout = Number(overrides.timeoutMs);
        const pollInterval = Number(overrides.pollIntervalMs);
        return {
            url: url.href,
            accessToken,
            getAccessToken,
            timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.min(timeout, 900000) : REQUEST_TIMEOUT_MS,
            pollIntervalMs: Number.isFinite(pollInterval) && pollInterval >= 100 ? Math.min(pollInterval, 10000) : 1000
        };
    }

    const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
    });

    async function responseJson(response, controller) {
        let payload;
        try { payload = await response.json(); }
        catch (error) {
            if (controller.signal.aborted) throw error;
            throw new Error('The agent service did not return valid JSON.');
        }
        if (!response.ok) {
            const serverMessage = typeof payload?.error?.message === 'string' ? payload.error.message.trim() : '';
            throw new Error(serverMessage || httpError(response.status));
        }
        return payload;
    }

    function authenticatedHeaders(config, requestId, includeContentType = false) {
        return {
            'Accept': 'application/json',
            'Authorization': `Bearer ${config.accessToken}`,
            'Idempotency-Key': requestId,
            ...(includeContentType ? { 'Content-Type': 'application/json' } : {})
        };
    }

    async function refreshAccessToken(config) {
        if (!config.getAccessToken) return false;
        const next = String(await config.getAccessToken() || '').trim();
        if (!next) throw new Error('Secure agent sign-in expired. Sign in again before continuing.');
        config.accessToken = next;
        return true;
    }

    async function authenticatedFetch(config, url, options, requestId, includeContentType = false) {
        const send = () => fetch(url, {
            ...options,
            headers: authenticatedHeaders(config, requestId, includeContentType)
        });
        let response = await send();
        if (response.status === 401 && await refreshAccessToken(config)) response = await send();
        return response;
    }

    async function waitForJob(initial, config, run, controller) {
        let payload = initial;
        const queued = new Set(['queued', 'running', 'retry']);
        if (!queued.has(payload?.status)) return payload;
        if (typeof payload.statusUrl !== 'string' || !payload.statusUrl.trim()) throw new Error('The agent queued this check without returning a status URL.');
        const statusUrl = new URL(payload.statusUrl, config.url);
        if (statusUrl.origin !== new URL(config.url).origin) throw new Error('The agent returned an unsafe cross-origin status URL.');
        while (queued.has(payload.status)) {
            await delay(config.pollIntervalMs, controller.signal);
            if (run.closed || run.cancelled || run.requestId !== payload.requestId) throw new DOMException('Cancelled', 'AbortError');
            const response = await authenticatedFetch(config, statusUrl.href, {
                method: 'GET',
                credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal
            }, run.requestId);
            payload = await responseJson(response, controller);
        }
        if (payload?.status === 'failed') throw new Error(payload?.error?.message || 'The agent could not finish this check after its retry attempts.');
        if (payload?.status === 'cancelled') throw new Error('The agent job was cancelled before it produced a report.');
        return payload;
    }

    function scoreTone(score) {
        if (score === null) return 'neutral';
        return score >= SCORE_THRESHOLDS.green ? 'green' : score >= SCORE_THRESHOLDS.yellow ? 'yellow' : 'red';
    }

    function scoreLabel(score) {
        return { green: 'Excellent', yellow: 'Needs improvement', red: 'Needs attention', neutral: 'No score yet' }[scoreTone(score)];
    }

    function gaugeMarkup(size) {
        return `<div class="gauge gauge-${size}" role="img" aria-label="Score not available">
            <svg viewBox="0 0 110 110" aria-hidden="true"><circle class="gauge-ticks" cx="55" cy="55" r="52" pathLength="100"/><circle class="gauge-track" cx="55" cy="55" r="44" pathLength="100"/><circle class="gauge-fill" cx="55" cy="55" r="44" pathLength="100"/></svg>
            <div class="gauge-center" aria-hidden="true"><strong class="gauge-value">—</strong><span class="gauge-unit">/ 100</span></div>
        </div>`;
    }

    function setGauge(gauge, score, scanning = false) {
        // Truncate display precision so 96.99 is never shown as a green-looking 97.
        const display = score === null ? '—' : String(Math.floor((score + Number.EPSILON) * 10) / 10);
        gauge.dataset.tone = scoreTone(score);
        gauge.dataset.scanning = String(scanning);
        gauge.querySelector('.gauge-value').textContent = display;
        gauge.querySelector('.gauge-fill').style.strokeDashoffset = score === null ? '' : String(100 - score);
        gauge.setAttribute('aria-label', score === null ? (scanning ? 'Checking; score not available yet' : 'Score not available') : `${display} out of 100. ${scoreLabel(score)}.`);
    }

    function createModal(run) {
        const host = document.createElement('div');
        host.id = 'agency-agent-executor';
        const shadow = host.attachShadow({ mode: 'open' });
        // Only static, developer-owned markup uses innerHTML. Store and server text
        // is assigned with textContent below, including all rule explanations.
        shadow.innerHTML = `<style>${STYLES}</style>
            <dialog aria-labelledby="agent-title" aria-describedby="agent-detail" data-phase="waiting">
                <div class="frame">
                    <header class="header">
                        <div class="brand" aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 7 3v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6l7-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/></svg></div>
                        <div class="heading"><span class="eyebrow">STORE AGENT / WEBSITE REPORT</span><h1 id="agent-title" dir="auto"></h1></div>
                        <div class="header-meta"><a class="website" target="_blank" rel="noopener noreferrer"></a><span class="run-badge">Not connected</span></div>
                        <button class="close" type="button" aria-label="Close agent checker" autofocus>×</button>
                    </header>
                    <main class="content">
                        <div class="intro"><div class="status-heading"><h2 class="status-title"></h2><span class="elapsed" aria-hidden="true"></span></div><p class="status-detail" id="agent-detail" role="status" aria-live="polite" aria-atomic="true"></p></div>
                        <p class="notice" role="alert" hidden></p>
                        <div class="workspace">
                            <aside class="overview" aria-label="Overall website score">
                                <h2>Website score</h2>${gaugeMarkup('large')}
                                <span class="score-grade">No score yet</span><p class="score-context"></p>
                                <div class="score-scale" aria-label="Score thresholds">
                                    <div class="scale-row"><span><i class="dot green"></i>Excellent</span><span>${SCORE_THRESHOLDS.green}–100</span></div>
                                    <div class="scale-row"><span><i class="dot yellow"></i>Needs improvement</span><span>${SCORE_THRESHOLDS.yellow}–&lt;${SCORE_THRESHOLDS.green}</span></div>
                                    <div class="scale-row"><span><i class="dot red"></i>Needs attention</span><span>0–&lt;${SCORE_THRESHOLDS.yellow}</span></div>
                                </div><p class="method-note"></p>
                            </aside>
                            <div class="report-body">
                                <section class="scan-panel" aria-label="Checker activity">
                                    <div class="scan-art" aria-hidden="true"><div class="scan-browser"><div class="browser-bar"><i></i><i></i><i></i></div><div class="browser-hero"></div><div class="browser-cards"><i></i><i></i><i></i></div><div class="scan-line"></div></div></div>
                                    <div class="scan-text"><h3 class="scan-heading"></h3><p class="scan-copy"></p>
                                        <div class="stages"><span class="stage"><i>1</i>Request</span><span class="stage-line"></span><span class="stage"><i>2</i>Checks</span><span class="stage-line"></span><span class="stage"><i>3</i>Report</span></div>
                                        <p class="scan-caption">Activity illustration · not a live website preview</p>
                                    </div>
                                </section>
                                <div class="progress" aria-hidden="true"><div class="progress-fill"></div></div>
                                <div class="summary" aria-label="Check summary"><div class="stat stat-pass"><strong>—</strong><span>Healthy checks</span></div><div class="stat stat-fail"><strong>—</strong><span>To improve</span></div><div class="stat stat-unknown"><strong>—</strong><span>Unscored</span></div></div>
                                <div class="rules-heading"><h2>Individual checks</h2><span class="rule-count"></span></div>
                                <ol aria-label="Agent rules"></ol><p class="empty" hidden>No rules yet. Add a checklist in Agent Rules, then open this store again.</p>
                                <div class="insights-grid">
                                    <section class="insight attention"><h3><i class="dot yellow"></i>What needs attention</h3><p class="insight-empty"></p><ul hidden></ul></section>
                                    <section class="insight strengths"><h3><i class="dot green"></i>What's working well</h3><p class="insight-empty"></p><ul hidden></ul></section>
                                </div>
                                <section class="teach-box" hidden><h3>Teach this store agent</h3><p>Add a verified instruction that should be remembered on future checks for this store.</p><div class="teach-controls"><textarea maxlength="4000" dir="auto" placeholder="Example: Payment icons in the footer are approved for this brand."></textarea><button type="button">Save lesson</button></div><p class="teach-status" role="status" aria-live="polite"></p></section>
                                <details hidden><summary>Agent instructions</summary><p class="persona" dir="auto"></p></details>
                            </div>
                        </div>
                    </main>
                    <footer class="footer"><p class="footnote"></p><div class="actions"><button class="button stop" type="button" hidden>Stop waiting</button><button class="button primary retry" type="button" hidden>Run again</button></div></footer>
                </div>
            </dialog>`;
        const find = selector => shadow.querySelector(selector);
        const ui = {
            host, dialog: find('dialog'), title: find('.status-title'), detail: find('.status-detail'),
            elapsed: find('.elapsed'), progress: find('.progress'), fill: find('.progress-fill'),
            notice: find('.notice'), footnote: find('.footnote'), retry: find('.retry'), stop: find('.stop'),
            counts: [find('.stat-pass strong'), find('.stat-fail strong'), find('.stat-unknown strong')], rows: [],
            overallGauge: find('.gauge-large'), grade: find('.score-grade'), scoreContext: find('.score-context'), method: find('.method-note'),
            badge: find('.run-badge'), scanTitle: find('.scan-heading'), scanCopy: find('.scan-copy'), stages: [...shadow.querySelectorAll('.stage')],
            attention: find('.attention'), strengths: find('.strengths'), teach: find('.teach-box'),
            teachInput: find('.teach-box textarea'), teachButton: find('.teach-box button'), teachStatus: find('.teach-status')
        };
        find('#agent-title').textContent = run.storeName;
        const website = find('.website');
        website.textContent = run.website || run.rawWebsite || 'No website assigned';
        if (run.website) website.href = run.website;
        find('.rule-count').textContent = `${run.rules.length} ${run.rules.length === 1 ? 'rule' : 'rules'}`;
        find('.empty').hidden = run.rules.length > 0;
        run.rules.forEach((rule, index) => {
            const row = document.createElement('li');
            row.className = 'rule';
            row.dataset.ruleId = run.ruleIds[index];
            row.innerHTML = `<div class="rule-top"><div class="rule-body"><div class="rule-number">CHECK ${String(index + 1).padStart(2, '0')}</div><p class="rule-name" dir="auto"></p><div class="rule-state"><span class="rule-icon" aria-hidden="true"></span><span class="rule-status"></span></div></div>${gaugeMarkup('small')}</div><p class="explanation" dir="auto" hidden></p><p class="recommendation" dir="auto" hidden></p><details class="evidence" hidden><summary>View captured evidence</summary><ul></ul></details><div class="feedback" hidden><div class="feedback-actions"><button class="confirm" type="button">Confirm finding</button><button class="correct" type="button">Correct & teach</button></div><div class="correction" hidden><textarea maxlength="4000" dir="auto" placeholder="Tell the agent what is correct and what it should remember."></textarea><input type="number" min="0" max="100" step="0.1" aria-label="Correct score" placeholder="Score 0–100"><div class="correction-buttons"><button class="save-correction" type="button">Save correction</button><button class="cancel-correction" type="button">Cancel</button></div></div><p class="feedback-status" role="status" aria-live="polite"></p></div>`;
            row.querySelector('.rule-name').textContent = rule;
            find('ol').appendChild(row);
            ui.rows.push({
                element: row, icon: row.querySelector('.rule-icon'), status: row.querySelector('.rule-status'),
                explanation: row.querySelector('.explanation'), gauge: row.querySelector('.gauge-small'), recommendation: row.querySelector('.recommendation'),
                evidence: row.querySelector('.evidence'), evidenceList: row.querySelector('.evidence ul'),
                feedback: row.querySelector('.feedback'), confirm: row.querySelector('.confirm'), correct: row.querySelector('.correct'),
                correction: row.querySelector('.correction'), correctionText: row.querySelector('.correction textarea'), correctionScore: row.querySelector('.correction input'),
                saveCorrection: row.querySelector('.save-correction'), cancelCorrection: row.querySelector('.cancel-correction'), feedbackStatus: row.querySelector('.feedback-status')
            });
        });
        if (run.description) {
            find('details').hidden = false;
            find('.persona').textContent = run.description;
        }
        find('.close').addEventListener('click', () => closeRun(run));
        ui.dialog.addEventListener('cancel', event => { event.preventDefault(); closeRun(run); });
        // Handle Escape explicitly before stopping app-level shortcuts. Keep
        // keyboard focus within the shadow-root dialog at either Tab boundary.
        ui.dialog.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRun(run);
            } else if (event.key === 'Tab') {
                const focusable = [...ui.dialog.querySelectorAll('a[href], button, summary')]
                    .filter(element => !element.disabled && element.getClientRects().length > 0);
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && shadow.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && shadow.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        });
        ui.dialog.addEventListener('click', event => {
            event.stopPropagation();
            const bounds = ui.dialog.getBoundingClientRect();
            if (event.target === ui.dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) closeRun(run);
        });
        ui.stop.addEventListener('click', () => {
            if (!run.busy) return;
            run.cancelled = true;
            run.controller.abort();
            finishWithoutResults(run, 'Stopped waiting', 'No final results were received here. The durable agent job may still be running.', 'cancelled');
        });
        ui.retry.addEventListener('click', () => { if (!run.busy) execute(run); });
        ui.rows.forEach(row => {
            row.correct.addEventListener('click', () => {
                row.correction.hidden = false;
                row.correctionText.focus();
            });
            row.cancelCorrection.addEventListener('click', () => {
                row.correction.hidden = true;
                row.feedbackStatus.textContent = '';
            });
            row.confirm.addEventListener('click', () => saveFeedback(run, row, { action: 'confirm' }));
            row.saveCorrection.addEventListener('click', () => {
                const lesson = row.correctionText.value.trim();
                const rawScore = row.correctionScore.value.trim();
                const correctedScore = rawScore === '' ? null : Number(rawScore);
                if (!lesson) {
                    row.feedbackStatus.textContent = 'Explain what the agent should remember before saving.';
                    return;
                }
                if (correctedScore !== null && (!Number.isFinite(correctedScore) || correctedScore < 0 || correctedScore > 100)) {
                    row.feedbackStatus.textContent = 'The corrected score must be between 0 and 100.';
                    return;
                }
                saveFeedback(run, row, { action: 'correct', lesson, correctedScore });
            });
        });
        ui.teachButton.addEventListener('click', () => saveLesson(run));
        document.body.appendChild(host);
        run.ui = ui;
        ui.dialog.showModal();
        return ui;
    }

    function setRule(row, state, explanation = '', score = null, recommendation = '', evidence = []) {
        const labels = { checking: 'Checking…', passed: 'Passed', failed: 'Failed', unknown: 'No result', waiting: 'Not started', cancelled: 'Not received' };
        const icons = { checking: '', passed: '✓', failed: '✕', unknown: '!', waiting: '·', cancelled: '—' };
        row.element.dataset.state = state;
        row.element.dataset.tone = scoreTone(score);
        row.element.setAttribute('aria-busy', state === 'checking' ? 'true' : 'false');
        row.icon.textContent = icons[state];
        row.status.textContent = score === null ? labels[state] : scoreLabel(score);
        row.explanation.textContent = explanation;
        row.explanation.hidden = !explanation;
        row.recommendation.textContent = recommendation ? `Suggested fix: ${recommendation}` : '';
        row.recommendation.hidden = !recommendation;
        row.evidenceList.replaceChildren();
        evidence.forEach(item => {
            const li = document.createElement('li');
            li.dir = 'auto';
            li.textContent = item;
            row.evidenceList.appendChild(li);
        });
        row.evidence.hidden = evidence.length === 0;
        row.evidence.open = false;
        setGauge(row.gauge, score, state === 'checking');
    }

    function updateDashboard(run, phase, results = []) {
        const ui = run.ui;
        ui.dialog.dataset.phase = phase;
        const scored = results.filter(result => result.score !== null);
        const complete = run.rules.length > 0 && scored.length === run.rules.length;
        const overall = complete ? scored.reduce((total, result) => total + result.score, 0) / scored.length : null;
        setGauge(ui.overallGauge, overall, phase === 'checking');
        ui.grade.dataset.tone = scoreTone(overall);
        const phases = {
            waiting: ['Not started', 'Ready to check this website', 'Complete the setup above to begin a real check of this website.', 'Awaiting check'],
            checking: ['Checking', 'Your checker is working', 'Request in progress. Scores and findings appear after your workflow responds.', 'Checking…'],
            complete: ['Report ready', 'Your website report is ready', 'Review the scores below, then explore the findings for each check.', 'Report ready'],
            incomplete: ['Partial report', 'Some results are missing', 'Completed checks appear below. The overall score waits for every check.', 'Incomplete'],
            error: ['No report', 'No verified results received', 'Check the connection message above before starting another request.', 'Not scored'],
            cancelled: ['Stopped', 'You stopped waiting', 'The workflow may still be running. No final score has been assigned.', 'Not scored']
        };
        const view = phases[phase];
        ui.badge.textContent = view[0];
        ui.scanTitle.textContent = view[1];
        ui.scanCopy.textContent = view[2];
        ui.grade.textContent = overall === null ? view[3] : scoreLabel(overall);
        ui.scoreContext.textContent = `${scored.length} of ${run.rules.length} checks scored${overall === null ? ' · overall score pending' : ''}`;
        ui.method.textContent = results.some(result => result.scoreSource === 'binary')
            ? 'Equal-weight average. Pass/fail checks use 100 or 0. Covers your configured checklist only.'
            : 'Equal-weight average of your configured checks. This is not an exhaustive website audit.';
        ui.stages.forEach((stage, index) => {
            const state = phase === 'complete' ? 'done' : phase === 'checking' ? (index === 0 ? 'done' : index === 1 ? 'active' : 'idle') : 'idle';
            stage.dataset.state = state;
            stage.querySelector('i').textContent = state === 'done' ? '✓' : String(index + 1);
        });
        const unscored = run.rules.length - scored.length;
        const fillInsights = (section, items, empty) => {
            const list = section.querySelector('ul');
            list.replaceChildren();
            section.querySelector('.insight-empty').textContent = empty;
            section.querySelector('.insight-empty').hidden = items.length > 0;
            list.hidden = items.length === 0;
            items.slice(0, 3).forEach(item => {
                const li = document.createElement('li');
                li.dir = 'auto';
                li.textContent = run.rules[run.ruleIds.indexOf(item.ruleId)];
                list.appendChild(li);
            });
            if (items.length > 3) {
                const li = document.createElement('li');
                li.textContent = `${items.length - 3} more in the individual checks above.`;
                list.appendChild(li);
            }
        };
        fillInsights(ui.attention, results.filter(result => result.state === 'failed'), results.length
            ? (unscored ? `No issues reported in the scored checks. ${unscored} checks are still unverified.` : 'No issues reported by your configured checks.')
            : 'Issues and improvement areas will appear after the checker returns its findings.');
        fillInsights(ui.strengths, results.filter(result => result.state === 'passed'), results.length
            ? 'No completed checks reached the green threshold yet.'
            : 'Healthy areas will appear here once they have been checked.');
        return overall;
    }

    function apiUrl(config, suffix) {
        const endpoint = new URL(config.url);
        endpoint.pathname = endpoint.pathname.replace(/\/checks\/?$/, `/checks${suffix}`);
        endpoint.search = '';
        return endpoint;
    }

    async function postAgent(run, url, body) {
        await refreshAccessToken(run.config);
        const mutationId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `agent-mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const response = await authenticatedFetch(run.config, url, {
            method: 'POST',
            credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
            signal: run.controller?.signal,
            body: JSON.stringify(body)
        }, mutationId, true);
        return responseJson(response, run.controller);
    }

    async function saveFeedback(run, row, feedback) {
        if (!run.config || !run.jobId || run.closed) return;
        const buttons = [row.confirm, row.correct, row.saveCorrection, row.cancelCorrection];
        buttons.forEach(button => { button.disabled = true; });
        row.feedbackStatus.textContent = 'Saving verified memory…';
        try {
            const result = await postAgent(run, apiUrl(run.config, `/${encodeURIComponent(run.jobId)}/feedback`), {
                ruleId: row.element.dataset.ruleId,
                ...feedback
            });
            row.feedbackStatus.textContent = result.verificationStatus === 'corrected'
                ? 'Correction saved as verified memory for future checks.'
                : 'Finding confirmed and saved as verified memory.';
            row.correction.hidden = true;
            row.confirm.hidden = true;
            row.correct.hidden = true;
        } catch (error) {
            row.feedbackStatus.textContent = error.message || 'The memory could not be saved.';
            buttons.forEach(button => { button.disabled = false; });
        }
    }

    async function saveLesson(run) {
        const content = run.ui.teachInput.value.trim();
        if (!content) {
            run.ui.teachStatus.textContent = 'Write the instruction you want the agent to remember.';
            return;
        }
        run.ui.teachButton.disabled = true;
        run.ui.teachStatus.textContent = 'Saving verified lesson…';
        try {
            const endpoint = new URL(run.config.url);
            endpoint.pathname = endpoint.pathname.replace(/\/checks\/?$/, '/lessons');
            endpoint.search = '';
            await postAgent(run, endpoint, { storeId: run.storeId, content });
            run.ui.teachInput.value = '';
            run.ui.teachStatus.textContent = 'Lesson saved. Future checks for this store will retrieve it.';
        } catch (error) {
            run.ui.teachStatus.textContent = error.message || 'The lesson could not be saved.';
        } finally { run.ui.teachButton.disabled = false; }
    }

    function clearTimers(run) {
        clearTimeout(run.timeout);
        clearInterval(run.ticker);
    }

    function settle(run, title, detail) {
        clearTimers(run);
        run.busy = false;
        run.ui.title.textContent = title;
        run.ui.detail.textContent = detail;
        run.ui.progress.dataset.running = 'false';
        run.ui.stop.hidden = true;
        run.ui.retry.hidden = false;
        run.ui.retry.textContent = 'Run again';
        run.ui.footnote.textContent = 'Results are supplied by the website agent. Review its evidence and teach corrections before relying on a new lesson.';
    }

    function finishWithoutResults(run, title, message, state = 'unknown') {
        settle(run, title, 'The checklist has not been verified.');
        run.ui.notice.textContent = message;
        run.ui.notice.hidden = false;
        run.ui.fill.style.width = '0%';
        run.ui.counts.forEach((count, index) => { count.textContent = index === 2 ? String(run.rules.length) : '0'; });
        run.ui.rows.forEach(row => setRule(row, state));
        updateDashboard(run, state === 'waiting' ? 'waiting' : state === 'cancelled' ? 'cancelled' : 'error');
        run.ui.retry.textContent = 'Try again';
        run.ui.footnote.textContent = state === 'waiting' ? 'No request has been sent. Your company data has not been changed.' : 'Retrying starts a new request. An earlier durable agent job may still be running.';
    }

    function closeRun(run, restoreFocus = true) {
        if (run.closed) return;
        run.closed = true;
        run.controller?.abort();
        if (run.config) {
            run.config.accessToken = '';
            run.config.getAccessToken = null;
        }
        clearTimers(run);
        run.ui?.dialog.close();
        run.ui?.host.remove();
        if (activeRun === run) activeRun = null;
        if (restoreFocus && run.previousFocus?.isConnected) run.previousFocus.focus({ preventScroll: true });
    }

    function readResults(payload, run) {
        // Legacy integrations can return a singleton array containing the final JSON object.
        if (Array.isArray(payload) && payload.length === 1 && Array.isArray(payload[0]?.results)) payload = payload[0];
        if (payload?.requestId !== undefined && payload.requestId !== run.requestId) throw new Error('The agent returned results for a different request. This checklist was not updated.');
        const results = Array.isArray(payload) ? payload : payload?.results;
        if (!Array.isArray(results)) throw new Error('The agent did not return a results array. No score has been assigned.');
        const hasIds = results.some(result => result && Object.prototype.hasOwnProperty.call(result, 'ruleId'));
        if (!hasIds && results.length !== run.rules.length) throw new Error('The response cannot be matched safely to these rules. Return a ruleId for each result, or one result per rule in the original order.');
        const byId = new Map();
        results.forEach((result, index) => {
            if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('The agent returned an invalid result object.');
            const id = hasIds ? result.ruleId : run.ruleIds[index];
            if (!run.ruleIds.includes(id) || byId.has(id)) throw new Error('The response contains missing, duplicate, or unknown rule IDs. Results were not assigned to the wrong rules.');
            byId.set(id, result);
        });
        return run.ruleIds.map(ruleId => {
            const result = byId.get(ruleId);
            if (!result) return { ruleId, state: 'unknown', score: null, scoreSource: null, explanation: 'The workflow did not return a result for this rule.', recommendation: '', evidence: [] };
            const hasScore = Object.prototype.hasOwnProperty.call(result, 'score');
            const validScore = typeof result.score === 'number' && Number.isFinite(result.score) && result.score >= 0 && result.score <= 100;
            const validVerdict = !hasScore && typeof result.passed === 'boolean';
            const score = hasScore ? (validScore ? result.score : null) : validVerdict ? (result.passed ? 100 : 0) : null;
            const explanation = typeof result.explanation === 'string' ? result.explanation.trim() : '';
            return {
                ruleId,
                state: score === null ? 'unknown' : score >= SCORE_THRESHOLDS.green ? 'passed' : 'failed',
                score,
                scoreSource: validScore ? 'numeric' : validVerdict ? 'binary' : null,
                explanation: explanation || (score !== null ? 'No explanation was supplied by the workflow.' : 'The workflow did not supply a valid score or pass/fail verdict for this rule.'),
                recommendation: typeof result.recommendation === 'string' ? result.recommendation.trim() : '',
                evidence: Array.isArray(result.evidence)
                    ? result.evidence.filter(item => typeof item === 'string' && item.trim()).slice(0, 12).map(item => item.trim().slice(0, 1000))
                    : []
            };
        });
    }

    function httpError(status) {
        if (status === 401 || status === 403) return 'The agent service denied access. Sign in again or check the server-side identity configuration.';
        if (status === 404) return 'The agent API route was not found. Check the deployed service URL.';
        if (status === 429) return 'The agent service is busy. Wait before trying again.';
        return `The agent service returned HTTP ${status}.`;
    }

    async function execute(run) {
        if (run.closed || run.busy) return;
        let config;
        try {
            if (run.inputError) throw new Error(run.inputError);
            if (!run.rules.length) throw new Error('Add at least one rule in Agent Rules, then close this checker and open the store again.');
            config = await getConfig();
        } catch (error) {
            finishWithoutResults(run, 'Setup needed', error.message, 'waiting');
            return { status: 'not-started' };
        }

        run.busy = true;
        run.config = config;
        run.jobId = '';
        run.cancelled = false;
        run.timedOut = false;
        run.requestId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const requestId = run.requestId;
        run.controller = new AbortController();
        const controller = run.controller;
        const startedAt = Date.now();
        run.ui.title.textContent = 'Checking your store';
        run.ui.detail.textContent = `Your agent is evaluating ${run.rules.length} ${run.rules.length === 1 ? 'rule' : 'rules'}. Results appear when its evidence-backed report is ready.`;
        run.ui.notice.hidden = true;
        run.ui.progress.dataset.running = 'true';
        run.ui.fill.style.width = '';
        run.ui.fill.style.background = '';
        run.ui.stop.hidden = false;
        run.ui.retry.hidden = true;
        run.ui.counts.forEach(count => { count.textContent = '—'; });
        run.ui.rows.forEach(row => {
            setRule(row, 'checking');
            row.feedback.hidden = true;
            row.correction.hidden = true;
            row.feedbackStatus.textContent = '';
            row.correctionText.value = '';
            row.correctionScore.value = '';
            [row.confirm, row.correct, row.saveCorrection, row.cancelCorrection].forEach(button => {
                button.disabled = false;
                button.hidden = false;
            });
        });
        run.ui.teach.hidden = true;
        run.ui.teachStatus.textContent = '';
        updateDashboard(run, 'checking');
        run.ui.footnote.textContent = 'Closing or stopping ends the wait here. The durable agent job may continue in the background.';
        const tick = () => {
            const seconds = Math.floor((Date.now() - startedAt) / 1000);
            run.ui.elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} elapsed`;
        };
        tick();
        run.ticker = setInterval(tick, 1000);
        run.timeout = setTimeout(() => { run.timedOut = true; controller.abort(); }, config.timeoutMs);

        try {
            const response = await authenticatedFetch(config, config.url, {
                method: 'POST',
                credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
                signal: controller.signal,
                body: JSON.stringify({
                    requestId, storeId: run.storeId, storeName: run.storeName, website: run.website,
                    agentDescription: run.description, agentRules: run.rules, ruleIds: run.ruleIds
                })
            }, requestId, true);
            let payload = await responseJson(response, controller);
            payload = await waitForJob(payload, config, run, controller);
            if (run.closed || run.cancelled || run.requestId !== requestId) return { status: 'cancelled' };
            if (controller.signal.aborted) throw new Error('The request was aborted before its results could be verified.');
            const results = readResults(payload, run);
            run.jobId = typeof payload.jobId === 'string' ? payload.jobId : '';
            const passed = results.filter(result => result.state === 'passed').length;
            const failed = results.filter(result => result.state === 'failed').length;
            const unknown = results.length - passed - failed;
            settle(run, unknown ? 'Your report is incomplete' : failed ? 'Here’s what needs attention' : 'Your website checks look good', `${passed + failed} of ${results.length} checks scored · ${passed} healthy · ${failed} to improve${unknown ? ` · ${unknown} unscored` : ''}`);
            run.ui.fill.style.width = `${((passed + failed) / results.length) * 100}%`;
            const overallScore = updateDashboard(run, unknown ? 'incomplete' : 'complete', results);
            run.ui.fill.style.background = overallScore === null ? '#bac7be' : ({ green: '#17aa68', yellow: '#d8a00a', red: '#e15c55' }[scoreTone(overallScore)]);
            [passed, failed, unknown].forEach((count, index) => { run.ui.counts[index].textContent = String(count); });
            results.forEach((result, index) => setRule(run.ui.rows[index], result.state, result.explanation, result.score, result.recommendation, result.evidence));
            if (run.jobId) {
                run.ui.rows.forEach(row => { row.feedback.hidden = false; });
                run.ui.teach.hidden = false;
            }
            if (unknown) {
                run.ui.notice.hidden = false;
                run.ui.notice.textContent = 'Some checks have no valid score. Their rings and the overall website score stay blank until every check has been verified.';
            }
            return { status: unknown ? 'incomplete' : 'completed', requestId, overallScore, results };
        } catch (error) {
            if (run.closed || run.cancelled || run.requestId !== requestId) return { status: 'cancelled' };
            const message = run.timedOut
                ? `No final response arrived within ${Math.round(config.timeoutMs / 1000)} seconds. The durable job may still be running; check the agent service logs.`
                : error instanceof TypeError
                    ? 'Could not reach the agent service. Check its URL, HTTPS certificate, and allowed browser origins. The job may already have started.'
                    : error.message || 'The request failed before results could be verified.';
            finishWithoutResults(run, run.timedOut ? 'The check timed out' : 'Could not complete the check', message);
            return { status: run.timedOut ? 'timeout' : 'error', requestId };
        } finally {
            // A stopped run can be retried before its fetch settles. Never clear
            // the newer run's timers or let an old response overwrite its UI.
            if (run.requestId === requestId) clearTimers(run);
        }
    }

    window.startAgentExecution = async function(cardData, agentDescription, agentRules) {
        const previousFocus = activeRun?.previousFocus || document.activeElement;
        if (activeRun) closeRun(activeRun, false);
        const card = cardData && typeof cardData === 'object' ? cardData : {};
        const rules = Array.isArray(agentRules) ? agentRules.filter(rule => typeof rule === 'string').map(rule => rule.trim()).filter(Boolean) : [];
        const run = {
            storeId: typeof card.id === 'string' || typeof card.id === 'number' ? String(card.id) : normalizeStoreId(card.title, card.agentWebsite),
            storeName: typeof card.title === 'string' && card.title.trim() ? card.title.trim() : 'Unnamed store',
            rawWebsite: typeof card.agentWebsite === 'string' ? card.agentWebsite.trim() : '',
            description: typeof agentDescription === 'string' ? agentDescription.trim() : '',
            rules, ruleIds: normalizeRuleIds(rules), previousFocus,
            closed: false, busy: false, inputError: '', website: ''
        };
        try { run.website = normalizeWebsite(run.rawWebsite); }
        catch (error) { run.inputError = error.message; }
        if (Array.isArray(agentRules) && agentRules.some(rule => typeof rule !== 'string')) run.inputError = 'Agent Rules must be a list of text instructions. Review the checklist before running it.';
        activeRun = run;
        createModal(run);
        return execute(run);
    };
})();
