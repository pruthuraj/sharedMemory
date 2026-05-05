const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'dashboard.js');
let content = fs.readFileSync(file, 'utf8');

// Find and replace the click handler to use the toggle function
const oldPattern = `        // Toggle expanded state on click
        if (expandedNodes.has(key)) {
            expandedNodes.delete(key);
        } else {
            expandedNodes.add(key);
        }
        openDetail(key, currentEntries[key] || entry);`;

const newPattern = `        // Toggle expanded state on click with animation
        toggleNodeExpanded(key, div, entry);
        openDetail(key, currentEntries[key] || entry);`;

if (content.includes(oldPattern)) {
  content = content.replace(oldPattern, newPattern);
  fs.writeFileSync(file, content);
  console.log('✓ Successfully updated click handler');
  console.log('✓ Click handler now calls toggleNodeExpanded()');
} else {
  console.log('Could not find exact pattern. Trying line-by-line approach...');
  
  const lines = content.split('\n');
  let foundIdx = -1;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Toggle expanded state on click') && 
        !lines[i].includes('animation')) {
      // Found the old comment
      if (i + 1 < lines.length && lines[i+1].includes('if (expandedNodes.has')) {
        // This looks like the old pattern
        foundIdx = i;
        break;
      }
    }
  }
  
  if (foundIdx >= 0) {
    lines[foundIdx] = '        // Toggle expanded state on click with animation';
    lines[foundIdx + 1] = '        toggleNodeExpanded(key, div, entry);';
    // Remove the old if/else block (next 3 lines)
    lines.splice(foundIdx + 2, 3);
    
    fs.writeFileSync(file, lines.join('\n'));
    console.log('✓ Successfully updated click handler using line-by-line');
  } else {
    console.log('Could not find click handler to update');
    process.exit(1);
  }
}
