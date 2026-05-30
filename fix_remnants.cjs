const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'components', 'workspace', 'SceneCard.module.css');

let content = fs.readFileSync(file, 'utf8');

const reps = [
  { regex: /background:\s*#0d0d1a/gi, replacement: 'background: var(--body-bg)' },
  { regex: /border-color:\s*#2a2a3e\b/gi, replacement: 'border-color: var(--panel-border)' },
  { regex: /background:\s*#3a3a5e\b/gi, replacement: 'background: var(--btn-default-bg)' },
  { regex: /border-color:\s*#4a4a6e\b/gi, replacement: 'border-color: var(--btn-default-border)' },
  { regex: /color:\s*#ccc\b/gi, replacement: 'color: var(--text-secondary)' },
];

reps.forEach(r => content = content.replace(r.regex, r.replacement));

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed SceneCard');
