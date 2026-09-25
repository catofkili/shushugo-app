import { Image } from '@tarojs/components';

type IconProps = { size?: number; color?: string; className?: string };
const icon = (name: string) => function TaroImageIcon({ size = 24, color = 'currentColor', className = '' }: IconProps) {
  const variant = color === '#FFFFFF' || className.includes('text-white') ? 'light' : 'ink';
  return <Image
    src={`/features/vocab-test/assets/lucide/${name}-${variant}.svg`}
    mode="aspectFit"
    className={className}
    style={{ width: size, height: size, flexShrink: 0 }}
  />;
};

export const ArrowLeftRight = icon('arrowleftright');
export const Check = icon('check');
export const Crown = icon('crown');
export const Handshake = icon('handshake');
export const History = icon('history');
export const ImageDown = icon('imagedown');
export const ListChecks = icon('listchecks');
export const Loader2 = icon('loader2');
export const MessageCircle = icon('messagecircle');
export const Pause = icon('pause');
export const PenLine = icon('penline');
export const Play = icon('play');
export const RotateCcw = icon('rotateccw');
export const Share2 = icon('share2');
export const ShieldCheck = icon('shieldcheck');
export const Sparkles = icon('sparkles');
export const Sprout = icon('sprout');
export const Timer = icon('timer');
export const Type = icon('type');
export const Volume2 = icon('volume2');
export const X = icon('x');
