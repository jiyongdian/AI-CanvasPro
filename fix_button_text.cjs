const fs = require('fs');
const path = require('path');

const srcDir = 'd:\\谪仙漫剧\\src';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(filePath));
    } else if (filePath.endsWith('.module.css')) {
      results.push(filePath);
    }
  });
  return results;
}

const files = walk(srcDir);

let changedFiles = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // A simple block parser:
  // Match each CSS rule block like: .className { ... }
  // We use regex to find everything between { and }
  
  let modified = false;
  
  const newContent = content.replace(/([^{]+)\{([^}]+)\}/g, (match, selector, block) => {
    
    // Check if the block has a strong background
    const hasStrongBg = 
      /background:\s*linear-gradient\([^)]*(#8b5cf6|#22c55e|#3a7bd5|#a855f7|#16a34a|#f97316|#ef4444)/i.test(block) ||
      /background:\s*(#8b5cf6|#22c55e|#3a7bd5|#a855f7|#16a34a|#f97316|#ef4444)/i.test(block);
      
    if (hasStrongBg && /color:\s*var\(--body-color\)/.test(block)) {
      const fixedBlock = block.replace(/color:\s*var\(--body-color\)/g, 'color: #ffffff');
      modified = true;
      return `${selector}{${fixedBlock}}`;
    }
    return match;
  });

  if (modified) {
    fs.writeFileSync(file, newContent, 'utf8');
    console.log('Fixed:', path.relative(srcDir, file));
    changedFiles++;
  }
});

console.log(`Total files fixed: ${changedFiles}`);
