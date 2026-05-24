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
let changedCount = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let modified = false;

  const newContent = content.replace(/([^{]+)\{([^}]+)\}/g, (match, selector, block) => {
    const isTranslucentOverlay = 
      /rgba\(0,\s*0,\s*0,\s*0\.7\)/i.test(block) ||
      /rgba\(0,\s*0,\s*0,\s*0\.8\)/i.test(block) ||
      /#52c41a/i.test(block) ||
      /linear-gradient\(180deg,\s*transparent\s*0%,\s*rgba\(0,\s*0,\s*0,\s*0\.7\)/i.test(block);

    if (isTranslucentOverlay) {
      if (/color:\s*var\(--body-color\)/i.test(block)) {
        block = block.replace(/color:\s*var\(--body-color\)/ig, 'color: #ffffff');
        modified = true;
      }
      if (/color:\s*#333/i.test(block)) {
        block = block.replace(/color:\s*#333/ig, 'color: #ffffff');
        modified = true;
      }
    }
    
    // Check specific selectors
    if (selector.includes('.characterName') || selector.includes('.styleName')) {
      if (/color:\s*var\(--body-color\)/i.test(block)) {
        block = block.replace(/color:\s*var\(--body-color\)/ig, 'color: #ffffff');
        modified = true;
      }
    }
    
    if (selector.includes('.imageHistoryIndex') || selector.includes('.imageHistoryCurrent')) {
      if (/color:\s*var\(--body-color\)/i.test(block)) {
        block = block.replace(/color:\s*var\(--body-color\)/ig, 'color: #ffffff');
        modified = true;
      }
    }

    if (modified) {
      return `${selector}{${block}}`;
    }
    return match;
  });

  if (modified) {
    fs.writeFileSync(file, newContent, 'utf8');
    console.log('Fixed overlay text:', path.basename(file));
    changedCount++;
  }
});

console.log(`Total files updated: ${changedCount}`);
