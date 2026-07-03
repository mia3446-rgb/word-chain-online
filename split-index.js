const fs = require('fs');
const path = require('path');

const root = process.cwd();
const publicDir = path.join(root, 'public');
const indexPath = path.join(publicDir, 'index.html');
const cssDir = path.join(publicDir, 'css');
const jsDir = path.join(publicDir, 'js');
const cssPath = path.join(cssDir, 'styles.css');
const jsPath = path.join(jsDir, 'app.js');

if (!fs.existsSync(indexPath)) {
  console.error('ERROR: public/index.html을 찾을 수 없습니다. 이 스크립트는 프로젝트 최상위 폴더에서 실행해야 합니다.');
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

if (html.includes('css/styles.css') && html.includes('js/app.js')) {
  console.log('이미 분리된 상태로 보입니다. 작업을 중단합니다.');
  process.exit(0);
}

const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
const scriptMatches = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];

if (!styleMatch) {
  console.error('ERROR: <style> 블록을 찾지 못했습니다.');
  process.exit(1);
}
if (scriptMatches.length === 0) {
  console.error('ERROR: inline <script> 블록을 찾지 못했습니다.');
  process.exit(1);
}

fs.mkdirSync(cssDir, { recursive: true });
fs.mkdirSync(jsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(publicDir, `index.backup-before-split-${stamp}.html`);
fs.writeFileSync(backupPath, html, 'utf8');

const css = styleMatch[1].trimStart();
const js = scriptMatches.map(m => m[1].trimStart()).join('\n\n/* ---- split from next inline script block ---- */\n\n');

fs.writeFileSync(cssPath, css, 'utf8');
fs.writeFileSync(jsPath, js, 'utf8');

html = html.replace(styleMatch[0], '<link rel="stylesheet" href="/css/styles.css">');

// Replace each inline script block. The first one becomes app.js, any additional inline script blocks are removed
// because they were appended into app.js in original order.
let replacedFirst = false;
html = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, () => {
  if (!replacedFirst) {
    replacedFirst = true;
    return '<script src="/js/app.js"></script>';
  }
  return '';
});

fs.writeFileSync(indexPath, html, 'utf8');

console.log('분리 완료!');
console.log('- 수정: public/index.html');
console.log('- 생성: public/css/styles.css');
console.log('- 생성: public/js/app.js');
console.log(`- 백업: ${path.relative(root, backupPath)}`);
console.log('테스트: node server.js 실행 후 http://localhost:3000 확인');
