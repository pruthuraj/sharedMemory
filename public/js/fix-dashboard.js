const path = require('path');

const file = path.join(__dirname, 'dashboard.js');

console.log(`Legacy helper retained at public/js. Current dashboard target: ${file}`);
console.log('No changes applied. The dashboard expansion logic is now maintained directly in public/js/dashboard.js.');
