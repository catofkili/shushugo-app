export const DailyPlanSlider = ({
  value,
  max,
  color,
  onChange,
  onCommit
}: {
  value: number;
  max: number;
  color: string;
  onChange: (value: number) => void;
  onCommit: () => void;
}) => <input
  type="range"
  min={0}
  max={max}
  value={value}
  onChange={(event) => onChange(Number(event.target.value))}
  onPointerUp={onCommit}
  onKeyUp={onCommit}
  onBlur={onCommit}
  style={{ accentColor: color }}
/>;
