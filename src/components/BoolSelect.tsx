interface BoolSelectProps {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}

export function BoolSelect({ label, value, onChange }: BoolSelectProps) {
  return (
    <label>
      {label}
      <select
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}
        required
      >
        <option value="">Select</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </label>
  );
}
