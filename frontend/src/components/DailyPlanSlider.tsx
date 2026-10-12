export const DailyPlanSlider = ({
  value,
  max,
  step = 1,
  color,
  onChange,
  onCommit
}: {
  value: number;
  max: number;
  step?: number;
  color?: string;
  onChange: (value: number) => void;
  onCommit?: () => void;
}) => <input
  className="w-full"
  type="range"
  min={0}
  max={max}
  step={step}
  value={value}
  onChange={(event) => onChange(Number(event.target.value))}
  onPointerUp={() => onCommit?.()}
  onKeyUp={() => onCommit?.()}
  onBlur={() => onCommit?.()}
  style={color ? { accentColor: color } : undefined}
/>;
