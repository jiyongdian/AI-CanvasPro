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
  let modified = false;
  
  const newContent = content.replace(/([^{]+)\{([^}]+)\}/g, (match, selector, block) => {
    // 检查是否有强烈的背景颜色 (Green/Purple/Blue/Orange/Red)
    const hasStrongBg = 
      /background:\s*linear-gradient\([^)]*(#8b5cf6|#22c55e|#3a7bd5|#a855f7|#16a34a|#f97316|#ef4444|#3b82f6)/i.test(block) ||
      /background(-color)?:\s*(#8b5cf6|#22c55e|#3a7bd5|#a855f7|#16a34a|#f97316|#ef4444|#3b82f6)/i.test(block);
      
    // 若块中包含这些强背景，强制要求字体为白色，否则加一句 color: #ffffff !important
    if (hasStrongBg) {
      if (/color:\s*(var\(--body-color\)|rgba\([^)]+\)|#[0-9a-f]{3,6})/i.test(block)) {
        // 如果有指定颜色，但不是白色，替换掉
        if (!/color:\s*#fff/i.test(block) && !/color:\s*#ffffff/i.test(block)) {
          let fixedBlock = block.replace(/color:[^;]+;/g, 'color: #ffffff !important;');
          modified = true;
          return `${selector}{${fixedBlock}}`;
        }
      } else {
        // 如果根本没有指定 color，强行加上
        modified = true;
        return `${selector}{${block}  color: #ffffff !important;\n}`;
      }
    }
    return match;
  });

  if (modified) {
    fs.writeFileSync(file, newContent, 'utf8');
    console.log('Forced white text on:', path.relative(srcDir, file));
    changedFiles++;
  }
});

console.log(`Total files fixed: ${changedFiles}`);
