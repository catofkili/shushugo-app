const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const icons = require('lucide-react');

const names = [
  'ArrowLeftRight', 'Check', 'Crown', 'Handshake', 'History', 'ImageDown',
  'ListChecks', 'Loader2', 'MessageCircle', 'Pause', 'PenLine', 'Play',
  'RotateCcw', 'Share2', 'ShieldCheck', 'Sparkles', 'Sprout', 'Timer',
  'Type', 'Volume2', 'X'
];
const out = path.join(__dirname, '../src/features/vocab-test/assets/lucide');
fs.mkdirSync(out, { recursive: true });

for (const name of names) {
  for (const [variant, color] of [['ink', '#3A2E22'], ['light', '#FFFFFF']]) {
    const markup = renderToStaticMarkup(React.createElement(icons[name], { size: 24, strokeWidth: 2 }))
      .replaceAll('currentColor', color);
    const svg = markup.includes('xmlns=') ? markup : markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    fs.writeFileSync(path.join(out, `${name.toLowerCase()}-${variant}.svg`), `${svg}\n`);
  }
}
console.log(`已生成 ${names.length * 2} 个 Lucide 静态 SVG 图标`);
