const fs = require('fs');
let code = fs.readFileSync('standalone/app.js', 'utf8');

const regexes = [
    { search: /list\.trackerType !== 'ads' && !list\.isClientHappiness/g, replace: "list.trackerType !== 'ads' && list.trackerType !== 'ads2' && !list.isClientHappiness" },
    { search: /targList\.trackerType !== 'ads' && targList\.trackerType !== 'trelloSpeech'/g, replace: "targList.trackerType !== 'ads' && targList.trackerType !== 'ads2' && targList.trackerType !== 'trelloSpeech'" },
    { search: /tl\.trackerType !== 'ads' && tl\.trackerType !== 'trelloSpeech'/g, replace: "tl.trackerType !== 'ads' && tl.trackerType !== 'ads2' && tl.trackerType !== 'trelloSpeech'" },
    { search: /cl\.trackerType !== 'ads'\)/g, replace: "cl.trackerType !== 'ads' && cl.trackerType !== 'ads2')" },
    { search: /list\.trackerType !== 'ads' && list\.cards\.length === 0/g, replace: "list.trackerType !== 'ads' && list.trackerType !== 'ads2' && list.cards.length === 0" },
    { search: /t\.trackerType !== 'ads' && t\.trackerType !== 'trelloSpeech'/g, replace: "t.trackerType !== 'ads' && t.trackerType !== 'ads2' && t.trackerType !== 'trelloSpeech'" },
    { search: /list\.trackerType !== 'ads' && list\.trackerType !== 'trelloSpeech'/g, replace: "list.trackerType !== 'ads' && list.trackerType !== 'ads2' && list.trackerType !== 'trelloSpeech'" },
    { search: /l\.trackerType !== 'ads' && l\.trackerType !== 'trelloSpeech'/g, replace: "l.trackerType !== 'ads' && l.trackerType !== 'ads2' && l.trackerType !== 'trelloSpeech'" },
    { search: /list\.trackerType !== 'ads';/g, replace: "list.trackerType !== 'ads' && list.trackerType !== 'ads2';" },
    { search: /list\.trackerType !== 'ads' && !list\.pipedriveStageId/g, replace: "list.trackerType !== 'ads' && list.trackerType !== 'ads2' && !list.pipedriveStageId" },
    { search: /targetList\.trackerType !== 'ads' && targetList\.trackerType !== 'trelloSpeech'/g, replace: "targetList.trackerType !== 'ads' && targetList.trackerType !== 'ads2' && targetList.trackerType !== 'trelloSpeech'" },
    { search: /targetList\.trackerType !== 'ads' && \(!targetList\.title/g, replace: "targetList.trackerType !== 'ads' && targetList.trackerType !== 'ads2' && (!targetList.title" }
];

regexes.forEach(r => {
    code = code.replace(r.search, r.replace);
});

fs.writeFileSync('standalone/app.js.fixed', code);
console.log("Done");
