const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'dashboard.js');
let content = fs.readFileSync(file, 'utf8');

// Fix the broken click handler
const broken = `        // Toggle expanded state on click with animation
        toggleNodeExpanded(key, div, entry);
        }
        openDetail(key, currentEntries[key] || entry);`;

const fixed = `        // Toggle expanded state on click with animation
        toggleNodeExpanded(key, div, entry);
        openDetail(key, currentEntries[key] || entry);`;

if (content.includes(broken)) {
  content = content.replace(broken, fixed);
  fs.writeFileSync(file, content);
  console.log('✓ Fixed syntax error in click handler');
} else {
  console.log('Could not find exact broken pattern');
}
