import { Image } from '@tarojs/components';

type IconProps = { size?: number; color?: string; className?: string };
const icon = (name: string) => function TaroImageIcon({ size = 24, color = 'currentColor', className = '' }: IconProps) {
  const variant = color === '#FFFFFF' || className.includes('text-white') ? 'light' : 'ink';
  return <Image
    src={`/assets/lucide/${name}-${variant}.svg`}
    mode="aspectFit"
    className={className}
    style={{ width: size, height: size, flexShrink: 0 }}
  />;
};

export const ArrowLeftRight = icon('arrowleftright');
export const ArrowRightLeft = icon('arrowrightleft');
export const AlertCircle = icon('alertcircle');
export const Brain = icon('brain');
export const CalendarDays = icon('calendardays');
export const CalendarCheck = icon('calendarcheck');
export const Check = icon('check');
export const CheckCircle2 = icon('checkcircle2');
export const ChevronRight = icon('chevronright');
export const ChevronLeft = icon('chevronleft');
export const Clock3 = icon('clock3');
export const Crown = icon('crown');
export const Eye = icon('eye');
export const Flame = icon('flame');
export const FolderPlus = icon('folderplus');
export const GitCompareArrows = icon('gitcomparearrows');
export const Handshake = icon('handshake');
export const History = icon('history');
export const ImageDown = icon('imagedown');
export const Languages = icon('languages');
export const ListChecks = icon('listchecks');
export const Loader2 = icon('loader2');
export const MessageCircle = icon('messagecircle');
export const Minus = icon('minus');
export const NotebookPen = icon('notebookpen');
export const Pause = icon('pause');
export const PenLine = icon('penline');
export const Pencil = icon('pencil');
export const Play = icon('play');
export const Plus = icon('plus');
export const Puzzle = icon('puzzle');
export const Repeat = icon('repeat');
export const RotateCcw = icon('rotateccw');
export const Share2 = icon('share2');
export const ShieldCheck = icon('shieldcheck');
export const Shuffle = icon('shuffle');
export const Sparkles = icon('sparkles');
export const Sprout = icon('sprout');
export const Star = icon('star');
export const StickyNote = icon('stickynote');
export const Target = icon('target');
export const Timer = icon('timer');
export const Type = icon('type');
export const Volume2 = icon('volume2');
export const X = icon('x');
