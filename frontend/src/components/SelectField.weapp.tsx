import { Picker, View } from "@tarojs/components";
import type { SelectFieldOption } from "./SelectField";

export function SelectField({
  options,
  value,
  onChange,
  className,
  ariaLabel
}: {
  options: SelectFieldOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel: string;
}) {
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <Picker
      mode="selector"
      range={options.map((option) => option.label)}
      value={selectedIndex}
      onChange={(event) => {
        const option = options[Number(event.detail.value)];
        if (option && !option.disabled) onChange(option.value);
      }}
    >
      <View aria-label={ariaLabel} className={className}>{options[selectedIndex]?.label ?? ""}</View>
    </Picker>
  );
}
