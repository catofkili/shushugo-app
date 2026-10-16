import { Slider } from "@tarojs/components";

export const DailyPlanSlider = ({
  value,
  min = 0,
  max,
  step = 1,
  color = "#7EBE4F",
  onChange,
  onCommit
}: {
  value: number;
  min?: number;
  max: number;
  step?: number;
  color?: string;
  onChange: (value: number) => void;
  onCommit?: () => void;
  label?: string;
}) => <Slider
  min={min}
  max={max}
  value={value}
  step={step}
  activeColor={color}
  backgroundColor="rgba(0,0,0,.15)"
  onChanging={(event) => onChange(event.detail.value)}
  onChange={(event) => { onChange(event.detail.value); onCommit?.(); }}
/>;
