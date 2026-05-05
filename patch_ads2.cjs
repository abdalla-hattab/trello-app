const fs = require('fs');
let code = fs.readFileSync('standalone/app.js', 'utf8');

// 1. formatNameMap
code = code.replace("'ads': 'Ads', 'trelloSpeech': 'Trello Tracker 2'", "'ads': 'Ads', 'ads2': 'Ads Tracker 2', 'trelloSpeech': 'Trello Tracker 2'");

// 2. format mappedType
code = code.replace("trackerType === 'trello-speech' ? 'trelloSpeech' : trackerType", "trackerType === 'trello-speech' ? 'trelloSpeech' : (trackerType === 'ads2' ? 'ads2' : trackerType)");

// 3. getGroupType
code = code.replace("if (l.trackerType === 'ads') return 'ads';", "if (l.trackerType === 'ads') return 'ads';\n                if (l.trackerType === 'ads2') return 'ads2';");

// 4. Options Menu (Unlink & Setup)
const unlinkAdsRegex = /if \(activeBoard\.trelloBoardId && \(list\.trackerType === 'ads' \|\| !list\.trelloListId\)\) \{[\s\S]*?optionsMenu\.appendChild\(opt\);\n        \}/;
const unlinkMatch = code.match(unlinkAdsRegex);
if (unlinkMatch) {
    let ads2Block = unlinkMatch[0].replace(/'ads'/g, "'ads2'").replace(/'Ads Tracker'/g, "'Ads Tracker 2'").replace(/Set Ads Layout/g, 'Set Ads 2 Layout');
    code = code.replace(unlinkMatch[0], unlinkMatch[0] + '\n\n        ' + ads2Block);
}

// 5. tBadge
const tBadgeRegex = /if \(list\.trackerType === 'ads'\) \{[\s\S]*?tBadge\.style\.border = '1px solid rgba\(0, 188, 212, 0\.3\)';\n            \}/;
const tBadgeMatch = code.match(tBadgeRegex);
if (tBadgeMatch) {
    let ads2Badge = tBadgeMatch[0].replace(/'ads'/g, "'ads2'").replace('Ads Tracker (', 'Ads Tracker 2 (').replace('Connected as an Ads Tracker', 'Connected as an Ads Tracker 2');
    ads2Badge = '} else ' + ads2Badge;
    code = code.replace(tBadgeMatch[0] + ' else if', tBadgeMatch[0] + ' ' + ads2Badge + ' else if');
}

// 6. hasAdsTrackers
code = code.replace(
    /const hasAdsTrackers = [^\;]+;/g,
    match => match + "\n            const hasAds2Trackers = activeBoard.connections && activeBoard.connections.some(c => c.source === list.id && c.sourcePort === edge && activeBoard.lists.find(l => l.id === c.target && l.trelloListId && l.trackerType === 'ads2'));"
);

// 7. hasTrackersOnEdge
code = code.replace("hasAdsTrackers ||", "hasAdsTrackers || hasAds2Trackers ||");

// 8. edgeDict
const edgeDictAdsRegex = /if \(hasAdsTrackers\) \{[\s\S]*?\}\n                \}/;
const edgeDictMatch = code.match(edgeDictAdsRegex);
if (edgeDictMatch) {
    let ads2Edge = edgeDictMatch[0].replace(/hasAdsTrackers/g, 'hasAds2Trackers').replace(/':ads'/g, "':ads2'").replace(/:ads/g, ":ads2").replace(/'application\/x-transfer-ads'/g, "'application/x-transfer-ads2'").replace(/data-tracker-type="ads"/g, 'data-tracker-type="ads2"').replace(/edgeDict\['ads'\]/g, "edgeDict['ads2']");
    code = code.replace(edgeDictMatch[0], edgeDictMatch[0] + '\n                \n                ' + ads2Edge);
}

// 9. matches
code = code.replace("if (tType === 'ads' && tl.trackerType === 'ads') matches = true;", "if (tType === 'ads' && tl.trackerType === 'ads') matches = true;\n                            if (tType === 'ads2' && tl.trackerType === 'ads2') matches = true;");

code = code.replace("if (mappedType === 'ads') return t.trackerType === 'ads';", "if (mappedType === 'ads') return t.trackerType === 'ads';\n                        if (mappedType === 'ads2') return t.trackerType === 'ads2';");

// 10. List order
code = code.replace(/\['clientHappiness', 'moneySmelling', 'newClients', 'pipedrive', 'trello', 'trelloSpeech', 'ads'\]/g, "['clientHappiness', 'moneySmelling', 'newClients', 'pipedrive', 'trello', 'trelloSpeech', 'ads', 'ads2']");

// 11. downstream summary stats
// In the tally calculation
code = code.replace("let aCards = 0; let aCol = { green: 0, yellow: 0, orange: 0, red: 0, default: 0 };", "let aCards = 0; let aCol = { green: 0, yellow: 0, orange: 0, red: 0, default: 0 };\n                    let a2Cards = 0; let a2Col = { green: 0, yellow: 0, orange: 0, red: 0, default: 0 };");
code = code.replace("const isAds = tList.trackerType === 'ads';", "const isAds = tList.trackerType === 'ads';\n                            const isAds2 = tList.trackerType === 'ads2';");
code = code.replace("if (isAds) hasAds = true;", "if (isAds) hasAds = true;\n                            else if (isAds2) hasAds2 = true;");
code = code.replace("let hasAds = false;", "let hasAds = false;\n                    let hasAds2 = false;");

code = code.replace(/if \(isAds\) \{\n                                        aCards\+\+; aCol\[msColValue\]\+\+;\n                                    \}/, "if (isAds) {\n                                        aCards++; aCol[msColValue]++;\n                                    } else if (isAds2) {\n                                        a2Cards++; a2Col[msColValue]++;\n                                    }");

const summaryAdsRender = `if (hasAds) {
                        const aText = aCards === 1 ? '1 Ad' : \`\${aCards} Ads\`;
                        finalHtml += \`
                            <div style="display:flex; align-items:center; gap: 8px; font-size: 12px; font-weight: 600;">
                                <div data-clicker="true" data-pid="\${list.id}" data-ptype="ads" data-pcolor="null" style="display:flex; align-items:center; gap: 4px; background: rgba(0, 188, 212, 0.15); color: #00838F; padding: 4px 10px; border-radius: 6px; cursor:pointer;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>
                                    <span>\${aText}</span>
                                </div>
                                \${buildTally(aCol, list.id, 'ads') !== '' ? \`<div style="display:flex; gap:6px;">\${buildTally(aCol, list.id, 'ads')}</div>\` : ''}
                            </div>
                        \`;
                    }`;

const summaryAds2Render = `if (hasAds2) {
                        const aText = a2Cards === 1 ? '1 Ad' : \`\${a2Cards} Ads\`;
                        finalHtml += \`
                            <div style="display:flex; align-items:center; gap: 8px; font-size: 12px; font-weight: 600;">
                                <div data-clicker="true" data-pid="\${list.id}" data-ptype="ads2" data-pcolor="null" style="display:flex; align-items:center; gap: 4px; background: rgba(0, 188, 212, 0.15); color: #00838F; padding: 4px 10px; border-radius: 6px; cursor:pointer;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>
                                    <span>\${aText} (2)</span>
                                </div>
                                \${buildTally(a2Col, list.id, 'ads2') !== '' ? \`<div style="display:flex; gap:6px;">\${buildTally(a2Col, list.id, 'ads2')}</div>\` : ''}
                            </div>
                        \`;
                    }`;

const adsRenderMatch = code.match(/if \(hasAds\) \{[\s\S]*?\}\n                    \}/);
if (adsRenderMatch) {
    code = code.replace(adsRenderMatch[0], adsRenderMatch[0] + '\n                    \n                    ' + summaryAds2Render);
}

// 12. Check trackerType === 'ads' everywhere else
code = code.replace(/list\.trackerType === 'ads' \|\| list\.trackerType === 'trelloSpeech'/g, "list.trackerType === 'ads' || list.trackerType === 'ads2' || list.trackerType === 'trelloSpeech'");
code = code.replace(/list\.trackerType === 'ads' \|\| list\.isPipedrive/g, "list.trackerType === 'ads' || list.trackerType === 'ads2' || list.isPipedrive");

code = code.replace("const isAdsTracker = targetLocalList && targetLocalList.trackerType === 'ads';", "const isAdsTracker = targetLocalList && (targetLocalList.trackerType === 'ads' || targetLocalList.trackerType === 'ads2');");
code = code.replace("const isAdsTracker = list.trackerType === 'ads';", "const isAdsTracker = list.trackerType === 'ads' || list.trackerType === 'ads2';");

code = code.replace("if (targList.trackerType === 'ads') hasAds = true;", "if (targList.trackerType === 'ads') hasAds = true;\n                            if (targList.trackerType === 'ads2') hasAds2 = true;");
code = code.replace("else if (targetList.trackerType === 'ads') myType = 'ads';", "else if (targetList.trackerType === 'ads') myType = 'ads';\n                    else if (targetList.trackerType === 'ads2') myType = 'ads2';");

code = code.replace(/if \(hasAds\) activeTypes\.push\('ads'\);/g, "if (hasAds) activeTypes.push('ads');\n                if (hasAds2) activeTypes.push('ads2');");

code = code.replace("if (list.pipedriveStageId || list.trackerType === 'ads') listContainer.classList.add('auto-height-list');", "if (list.pipedriveStageId || list.trackerType === 'ads' || list.trackerType === 'ads2') listContainer.classList.add('auto-height-list');");

code = code.replace("} else if (pType === 'ads' && cl.trackerType === 'ads') {", "} else if ((pType === 'ads' && cl.trackerType === 'ads') || (pType === 'ads2' && cl.trackerType === 'ads2')) {");

code = code.replace("if (srcList.trackerType === 'ads') delete srcList.trackerType;", "if (srcList.trackerType === 'ads' || srcList.trackerType === 'ads2') delete srcList.trackerType;");

code = code.replace("} else if (list.trackerType === 'ads') {", "} else if (list.trackerType === 'ads' || list.trackerType === 'ads2') {");

code = code.replace("const isAdsTrackerNode = list.trackerType === 'ads';", "const isAdsTrackerNode = list.trackerType === 'ads' || list.trackerType === 'ads2';");

code = code.replace("targetList.trackerType === 'ads'", "(targetList.trackerType === 'ads' || targetList.trackerType === 'ads2')");

code = code.replace("const isAds = list.trackerType === 'ads';", "const isAds = list.trackerType === 'ads' || list.trackerType === 'ads2';");

code = code.replace("t.list.trackerType !== 'ads'", "t.list.trackerType !== 'ads' && t.list.trackerType !== 'ads2'");
code = code.replace("t => t.list.trackerType === 'ads'", "t => t.list.trackerType === 'ads' || t.list.trackerType === 'ads2'");

fs.writeFileSync('standalone/app.js.new', code);
