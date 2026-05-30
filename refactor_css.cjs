const fs = require('fs');
const path = require('path');

const cssFiles = [
  'ProjectList.module.css',
  'Workspace.module.css',
  'CharacterLibrary.module.css',
  'AICharacter.module.css',
  'Settings.module.css',
  'StyleLibrary.module.css'
];

const basePath = path.join(__dirname, 'src', 'pages');

const replacements = [
  // Backgrounds
  { regex: /background:\s*linear-gradient\(145deg,\s*#282828\s*0%,\s*#1e1e1e\s*100%\)/g, replacement: 'background: var(--panel-bg-gradient)' },
  { regex: /background:\s*linear-gradient\(145deg,\s*#1a1a1a\s*0%,\s*#141414\s*100%\)/g, replacement: 'background: var(--input-bg)' },
  { regex: /background:\s*linear-gradient\(145deg,\s*#222\s*0%,\s*#1a1a1a\s*100%\)/g, replacement: 'background: var(--modal-footer-bg)' },
  { regex: /background:\s*linear-gradient\(145deg,\s*#3a3a3a\s*0%,\s*#2a2a2a\s*100%\)/g, replacement: 'background: var(--btn-default-bg)' },
  { regex: /background:\s*linear-gradient\(180deg,\s*#0f0f0f\s*0%,\s*#1a1a1a\s*100%\)/g, replacement: 'background: var(--body-bg)' },
  { regex: /background:\s*transparent/g, replacement: 'background: transparent' }, // Just in case, no change.
  
  // Borders
  { regex: /border:\s*1px\s*solid\s*#3a3a3a/g, replacement: 'border: 1px solid var(--panel-border)' },
  { regex: /border:\s*1px\s*solid\s*#333/g, replacement: 'border: 1px solid var(--item-border-color)' },
  { regex: /border-color:\s*#333/g, replacement: 'border-color: var(--item-border-color)' },
  { regex: /border:\s*1px\s*solid\s*#4a4a4a/g, replacement: 'border: 1px solid var(--btn-default-border)' },
  { regex: /border:\s*1px\s*solid\s*#2a2a2a/g, replacement: 'border: 1px solid var(--panel-border)' },
  { regex: /border-bottom:\s*1px\s*solid\s*rgba\(255,\s*255,\s*255,\s*0\.08\)/g, replacement: 'border-bottom: 1px solid var(--modal-header-border)' },
  { regex: /border-top:\s*1px\s*solid\s*rgba\(255,\s*255,\s*255,\s*0\.08\)/g, replacement: 'border-top: 1px solid var(--modal-header-border)' },
  { regex: /border-top:\s*1px\s*solid\s*#333/g, replacement: 'border-top: 1px solid var(--modal-header-border)' },
  { regex: /border:\s*1px\s*dashed\s*#3a3a3a/g, replacement: 'border: 1px dashed var(--panel-border)' },
  { regex: /border:\s*1px\s*dashed\s*#333/g, replacement: 'border: 1px dashed var(--item-border-color)' },
  { regex: /border-bottom:\s*1px\s*solid\s*#333/g, replacement: 'border-bottom: 1px solid var(--item-border-color)' },
  { regex: /border-color:\s*#555/g, replacement: 'border-color: var(--item-border-color)' },

  // Colors
  { regex: /color:\s*#e5e5e5/g, replacement: 'color: var(--body-color)' },
  { regex: /color:\s*#fff(?!;)/g, replacement: 'color: var(--body-color)' },
  { regex: /color:\s*#fff;/g, replacement: 'color: var(--body-color);' },
  { regex: /color:\s*#a0a0a0/g, replacement: 'color: var(--text-secondary)' },
  { regex: /color:\s*#888/g, replacement: 'color: var(--text-secondary)' },
  { regex: /color:\s*#666/g, replacement: 'color: var(--text-secondary)' },
  { regex: /color:\s*#b0b0b0/g, replacement: 'color: var(--placeholder-color)' },
  { regex: /color:\s*#555/g, replacement: 'color: var(--placeholder-color)' },
  { regex: /color:\s*#d0d0d0/g, replacement: 'color: var(--text-secondary)' },
  { regex: /color:\s*#e0e0e0/g, replacement: 'color: var(--body-color)' },
  
  // Shadows (simple approximations)
  { regex: /rgba\(0,\s*0,\s*0,\s*0\.3\)/g, replacement: 'var(--shadow-light)' },
  { regex: /rgba\(0,\s*0,\s*0,\s*0\.4\)/g, replacement: 'var(--shadow-base)' },
  { regex: /rgba\(0,\s*0,\s*0,\s*0\.5\)/g, replacement: 'var(--shadow-heavy)' },
  { regex: /rgba\(0,\s*0,\s*0,\s*0\.2\)/g, replacement: 'var(--shadow-light)' },
  { regex: /rgba\(0,\s*0,\s*0,\s*0\.6\)/g, replacement: 'var(--shadow-heavy)' },
  // specific inset shadow fixes
  { regex: /inset\s*0\s*1px\s*0\s*rgba\(255,\s*255,\s*255,\s*0\.[0-9]+\)/g, replacement: 'inset 0 1px 0 var(--glass-border)' },
  
  // Backgrounds with rgba
  { regex: /background:\s*rgba\(255,\s*255,\s*255,\s*0\.0[0-9]+\)/g, replacement: 'background: var(--icon-hover-bg)' },
];

cssFiles.forEach(file => {
  const filePath = path.join(basePath, file);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Append local variables to provide customized fixes if any standard replacements missed
  // but just replacing with standard CSS variables is sufficient to make it responsive.
  
  replacements.forEach(r => {
    content = content.replace(r.regex, r.replacement);
  });
  
  // specific fix for some missed gradients
  content = content.replace(/linear-gradient\(145deg,\s*#444\s*0%,\s*#333\s*100%\)/g, 'var(--btn-default-hover-bg)');
  content = content.replace(/background:\s*linear-gradient\(180deg,\s*transparent\s*0%,\s*rgba\(0,\s*0,\s*0,\s*0\.9\)\s*100%\)/g, 'background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.7) 100%)'); // keep this dark for text readability on images
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Processed: ${file}`);
});
