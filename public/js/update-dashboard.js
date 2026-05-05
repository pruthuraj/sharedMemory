const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'dashboard.js');
let content = fs.readFileSync(file, 'utf8');

// Add helper function before buildNodeEl
const helperFunc = `
// Toggle node between round and expanded state
function toggleNodeExpanded(key, nodeEl, entry) {
    if (expandedNodes.has(key)) {
        expandedNodes.delete(key);
        nodeEl.classList.remove('expanded');
        nodeEl.classList.add('round');
    } else {
        expandedNodes.add(key);
        nodeEl.classList.remove('round');
        nodeEl.classList.add('expanded');
    }
}

`;

const marker = '// ── Node rendering';
const beforeMarker = content.indexOf(marker);
if (beforeMarker > 0) {
    content = content.substring(0, beforeMarker) + helperFunc + content.substring(beforeMarker);

    // Replace the click handler
    const oldClick = `// Toggle expanded state on click
        if (expandedNodes.has(key)) {
            expandedNodes.delete(key);
        } else {
            expandedNodes.add(key);
        }`;

    const newClick = `// Toggle expanded state on click with animation
        toggleNodeExpanded(key, div, entry);`;

    if (content.includes(oldClick)) {
        content = content.replace(oldClick, newClick);
        fs.writeFileSync(file, content);
        console.log('✓ Updated dashboard.js successfully');
        console.log('✓ Added toggleNodeExpanded() function');
        console.log('✓ Updated click handler to toggle transformation');
    } else {
        console.log('Could not find exact click handler');
    }
} else {
    console.log('Marker not found');
}
