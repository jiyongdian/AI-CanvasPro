const fs = require('fs');
const path = require('path');

const cssFiles = [
  'd:\\谪仙漫剧\\src\\components\\workspace\\SceneNavigator.module.css',
  'd:\\谪仙漫剧\\src\\components\\workspace\\SceneCard.module.css',
  'd:\\谪仙漫剧\\src\\components\\workspace\\SceneManagerModal.module.css',
  'd:\\谪仙漫剧\\src\\components\\workspace\\SceneLocationItem.module.css',
];

const replacements = [
  // SceneNavigator & SceneCard special hexes
  { regex: /background:\s*#141420/gi, replacement: 'background: var(--body-bg)' },
  { regex: /background:\s*#1a1a2e/gi, replacement: 'background: var(--panel-bg-gradient)' },
  { regex: /background:\s*#222238/gi, replacement: 'background: var(--input-bg)' },
  { regex: /border:\s*(\d+px)\s+solid\s+#2a2a3e/gi, replacement: 'border: $1 solid var(--panel-border)' },
  { regex: /border-bottom:\s*(\d+px)\s+solid\s+#2a2a3e/gi, replacement: 'border-bottom: $1 solid var(--panel-border)' },
  { regex: /background:\s*#2a2a3e/gi, replacement: 'background: var(--input-bg)' },
  { regex: /border-color:\s*#3a3a5e/gi, replacement: 'border-color: var(--item-border-color)' },
  { regex: /background:\s*#16213e/gi, replacement: 'background: var(--modal-footer-bg)' },
  { regex: /border:\s*(\d+px)\s+solid\s+#3a3a5e/gi, replacement: 'border: $1 solid var(--panel-border)' },

  // SceneCard specific gradients
  { regex: /background:\s*linear-gradient\(145deg,\s*#1e1e1e\s*0%,\s*#1a1a1a\s*100%\)/gi, replacement: 'background: var(--input-bg)' },
  { regex: /background:\s*linear-gradient\(145deg,\s*#2a2a2a\s*0%,\s*#22(2)?\s*100%\)/gi, replacement: 'background: var(--modal-footer-bg)' },
  { regex: /background:\s*linear-gradient\(145deg,\s*#323232\s*0%,\s*#282828\s*100%\)/gi, replacement: 'background: var(--panel-bg-gradient)' },

  // extra color fixes
  { regex: /color:\s*#c0c0c0/gi, replacement: 'color: var(--text-secondary)' },
  { regex: /color:\s*#777/gi, replacement: 'color: var(--text-secondary)' },
  { regex: /color:\s*#aaa/gi, replacement: 'color: var(--text-secondary)' },
  { regex: /color:\s*#bbbbbb/gi, replacement: 'color: var(--text-secondary)' },
  
  // SceneManagerModal gradients
  { regex: /background:\s*linear-gradient\(145deg,\s*#333\s*0%,\s*#222\s*100%\)/gi, replacement: 'background: var(--panel-bg-gradient)' },
];

cssFiles.forEach(filePath => {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    replacements.forEach(r => {
      content = content.replace(r.regex, r.replacement);
    });
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Processed: ${path.basename(filePath)}`);
  }
});
