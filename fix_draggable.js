const fs = require('fs');
const file = '/Users/agencygrow/Desktop/trello app/standalone/app.js';
let content = fs.readFileSync(file, 'utf8');

// Replace the dropAttr definitions
content = content.replace(/const dropAttr\s*=\s*`ondragover="event\.preventDefault\(\);" ondrop="if\(window\.handleToggleReorder\) window\.handleToggleReorder\(event, '\$\{list\.id\}', '\$\{edge\}', '[^']+'\);"`\;/g, 'const dropAttr = "";');

// Replace draggable and ondragstart
content = content.replace(/draggable="true"\s+ondragstart="event\.stopPropagation\(\);\s*event\.dataTransfer\.setData\('application\/x-transfer-[^']+', '\$\{list\.id\}'\);\s*event\.dataTransfer\.effectAllowed='move';"/g, '');

// Change cursor from inherit to pointer
content = content.replace(/style="cursor:inherit;/g, 'style="cursor:pointer;');

fs.writeFileSync(file, content);
console.log("Replaced drag attributes");
