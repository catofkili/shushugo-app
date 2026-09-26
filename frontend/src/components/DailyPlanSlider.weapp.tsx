import { Slider } from "@tarojs/components";

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
}) => <Slider
  min={0}
  max={max}
  value={value}
  step={1}
  activeColor={color}
  backgroundColor="rgba(0,0,0,.15)"
  onChanging={(event) => onChange(event.detail.value)}
  onChange={(event) => { onChange(event.detail.value); onCommit(); }}
/>;
