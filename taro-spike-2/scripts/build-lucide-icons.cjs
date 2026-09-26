const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const icons = require('lucide-react');

const names = [
  'AlertCircle', 'ArrowLeft', 'ArrowLeftRight', 'ArrowRightLeft', 'BookOpenCheck', 'Brain', 'CalendarCheck', 'CalendarDays',
  'Check', 'CheckCircle2', 'ChevronDown', 'ChevronLeft', 'ChevronRight', 'Clock3', 'Crown', 'Eye', 'ExternalLink', 'Flame',
  'FolderPlus', 'GitCompareArrows', 'Handshake', 'History', 'ImageDown', 'Languages', 'Layers', 'ListChecks',
  'Loader2', 'MessageCircle', 'Minus', 'NotebookPen', 'Pause', 'PenLine', 'Pencil', 'PencilLine', 'Play', 'Plus',
  'Puzzle', 'Repeat', 'RotateCcw', 'Search', 'Send', 'Share2', 'ShieldCheck', 'Shuffle', 'Sparkles', 'Sprout', 'Star',
  'StickyNote', 'Target', 'Timer', 'Trash2', 'Type', 'Undo2', 'Volume2', 'X', 'XCircle'
];
const out = path.join(__dirname, '../src/assets/lucide');
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
