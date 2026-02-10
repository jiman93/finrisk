import type { CheckpointFieldDefinition } from "../../types";

interface FieldRendererProps {
  field: CheckpointFieldDefinition;
  value: unknown;
  disabled?: boolean;
  onChange: (nextValue: unknown) => void;
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function toArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export default function FieldRenderer({ field, value, disabled, onChange }: FieldRendererProps) {
  if (field.type === "textarea") {
    return (
      <textarea
        className="pi-form-control pi-form-textarea"
        value={toStringValue(value)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder ?? ""}
        disabled={disabled}
        rows={5}
      />
    );
  }

  if (field.type === "select") {
    return (
      <select
        className="pi-form-control"
        value={toStringValue(value)}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">Select option</option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "radio") {
    return (
      <div className="pi-option-group">
        {(field.options ?? []).map((option) => (
          <label key={option.value} className="pi-option-item">
            <input
              type="radio"
              name={field.key}
              value={option.value}
              checked={toStringValue(value) === option.value}
              onChange={() => onChange(option.value)}
              disabled={disabled}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label className="pi-option-item">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === "multi_select" || field.type === "chips") {
    if ((field.options ?? []).length > 0) {
      const selected = new Set(toArrayValue(value));
      return (
        <div className="pi-chip-grid">
          {(field.options ?? []).map((option) => {
            const active = selected.has(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`pi-chip-toggle ${active ? "active" : ""}`}
                disabled={disabled}
                onClick={() => {
                  const next = new Set(selected);
                  if (next.has(option.value)) {
                    next.delete(option.value);
                  } else {
                    next.add(option.value);
                  }
                  onChange(Array.from(next));
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <input
        className="pi-form-control"
        value={toArrayValue(value).join(", ")}
        onChange={(event) => {
          const next = event.target.value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          onChange(next);
        }}
        placeholder={field.placeholder ?? "Comma-separated values"}
        disabled={disabled}
      />
    );
  }

  if (field.type === "number" || field.type === "range") {
    return (
      <input
        className="pi-form-control"
        type="number"
        min={field.min ?? undefined}
        max={field.max ?? undefined}
        value={typeof value === "number" ? value : ""}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? "" : Number(raw));
        }}
        disabled={disabled}
      />
    );
  }

  return (
    <input
      className="pi-form-control"
      type="text"
      value={toStringValue(value)}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder ?? ""}
      disabled={disabled}
    />
  );
}
