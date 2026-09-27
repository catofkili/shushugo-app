export interface SelectFieldOption {
  value: string;
  label: string;
  disabled?: boolean;
}

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
  return (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} className={className}>
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  );
}
