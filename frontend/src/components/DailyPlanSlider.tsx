export const DailyPlanSlider = ({
  value,
  min = 0,
  max,
  step = 1,
  disabled = false,
  color,
  onChange,
  onCommit,
  label
}: {
  value: number;
  min?: number;
  max: number;
  step?: number;
  disabled?: boolean;
  color?: string;
  onChange: (value: number) => void;
  onCommit?: () => void;
  label?: string;
}) => <input
  className="w-full"
  type="range"
  min={min}
  max={max}
  step={step}
  disabled={disabled}
  value={value}
  onChange={(event) => onChange(Number(event.target.value))}
  onPointerUp={() => onCommit?.()}
  onKeyUp={() => onCommit?.()}
  onBlur={() => onCommit?.()}
  style={color ? { accentColor: color } : undefined}
  aria-label={label}
/>;
