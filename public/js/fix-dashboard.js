const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'dashboard.js');
let content = fs.readFileSync(file, 'utf8');

// Check if helper already exists
if (content.includes('function toggleNodeExpanded')) {
    console.log('Helper function already exists - skipping');
    process.exit(0);
}

// Add helper function before buildNodeEl
const marker = '// ── Node rendering';
const idx = content.indexOf(marker);

if (idx < 0) {
    console.log('ERROR: Marker not found');
    process.exit(1);
}

const helperCode = `
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

// Insert helper before marker
content = content.substring(0, idx) + helperCode + content.substring(idx);

// Now find and replace the click handler
// Split by lines to find the exact section
const lines = content.split('\n');
let foundLine = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('// Toggle expanded state on click') &&
        i + 4 < lines.length &&
        lines[i + 4].trim().includes('expandedNodes.add')) {
        foundLine = i;
        break;
    }
}

if (foundLine >= 0) {
    // Replace the block (lines foundLine through foundLine+4)
    lines[foundLine] = '        // Toggle expanded state on click with animation';
    lines[foundLine + 1] = '        toggleNodeExpanded(key, div, entry);';
    // Remove lines foundLine+2 through foundLine+4
    lines.splice(foundLine + 2, 3);

    // Write back
    fs.writeFileSync(file, lines.join('\n'));
    console.log('✓ Successfully updated dashboard.js');
    console.log('✓ Added toggleNodeExpanded() function');
    console.log('✓ Updated click handler to call toggle function');
} else {
    console.log('Could not find click handler block to replace');
}
