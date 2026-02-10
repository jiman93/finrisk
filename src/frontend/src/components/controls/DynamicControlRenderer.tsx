import { useEffect, useMemo, useState } from "react";

import type { CheckpointFieldDefinition, CheckpointInstanceResponse } from "../../types";
import FieldRenderer from "./FieldRenderer";

interface DynamicControlRendererProps {
  instance: CheckpointInstanceResponse;
  initialData?: Record<string, unknown>;
  fieldErrors?: Record<string, string>;
  submitError?: string;
  submitting?: boolean;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onSkip: () => Promise<void>;
  onRetry: () => Promise<void>;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function defaultValueForField(field: CheckpointFieldDefinition): unknown {
  if (field.default !== undefined && field.default !== null) {
    return field.default;
  }
  if (field.type === "multi_select" || field.type === "chips") {
    return [];
  }
  if (field.type === "checkbox") {
    return false;
  }
  if (field.type === "number" || field.type === "range") {
    return "";
  }
  return "";
}

function buildInitialData(
  instance: CheckpointInstanceResponse,
  initialData?: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const field of instance.field_schema) {
    next[field.key] = defaultValueForField(field);
  }
  if (initialData) {
    for (const [key, value] of Object.entries(initialData)) {
      next[key] = value;
    }
  }
  if (instance.submit_result) {
    for (const [key, value] of Object.entries(instance.submit_result)) {
      next[key] = value;
    }
  }
  return next;
}

function toSummary(data: Record<string, unknown>, fields: CheckpointFieldDefinition[]): string {
  const parts = fields.flatMap((field) => {
    const value = data[field.key];
    if (isEmpty(value)) {
      return [];
    }
    if (Array.isArray(value)) {
      return `${field.label}: ${value.join(", ")}`;
    }
    if (typeof value === "boolean") {
      return `${field.label}: ${value ? "Yes" : "No"}`;
    }
    return `${field.label}: ${String(value)}`;
  });
  return parts.join(" | ");
}

export default function DynamicControlRenderer({
  instance,
  initialData,
  fieldErrors,
  submitError,
  submitting,
  onSubmit,
  onSkip,
  onRetry,
}: DynamicControlRendererProps) {
  const initialDataHash = useMemo(() => JSON.stringify(initialData ?? {}), [initialData]);
  const [formData, setFormData] = useState<Record<string, unknown>>(() =>
    buildInitialData(instance, initialData)
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setFormData(buildInitialData(instance, initialData));
    setClientErrors({});
  }, [instance.id, initialDataHash]);

  const mergedErrors = { ...clientErrors, ...(fieldErrors ?? {}) };
  const isFinal = instance.state === "submitted" || instance.state === "collapsed" || instance.state === "skipped";

  async function handleSubmit() {
    const nextErrors: Record<string, string> = {};
    for (const field of instance.field_schema) {
      if (field.required && isEmpty(formData[field.key])) {
        nextErrors[field.key] = "This field is required.";
      }
    }

    setClientErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    await onSubmit(formData);
  }

  return (
    <div className="pi-inline-control-card pi-checkpoint-card">
      <div className="pi-selector-header">
        <span>{instance.label}</span>
        <span className="pi-selector-meta">
          {instance.state}
          {instance.required ? " • required" : " • optional"}
        </span>
      </div>

      {isFinal ? (
        <div className="pi-checkpoint-summary">
          {instance.state === "skipped"
            ? "Skipped."
            : toSummary(instance.submit_result ?? {}, instance.field_schema) || "Submitted."}
        </div>
      ) : (
        <>
          {instance.field_schema.map((field) => (
            <div key={field.key}>
              <label className="pi-form-label" htmlFor={`${instance.id}-${field.key}`}>
                {field.label}
                {field.required ? " *" : ""}
              </label>
              <FieldRenderer
                field={field}
                value={formData[field.key]}
                disabled={Boolean(submitting)}
                onChange={(nextValue) =>
                  setFormData((prev) => ({
                    ...prev,
                    [field.key]: nextValue,
                  }))
                }
              />
              {mergedErrors[field.key] ? (
                <div className="pi-field-error">{mergedErrors[field.key]}</div>
              ) : null}
            </div>
          ))}

          {submitError || instance.last_error ? (
            <div className="pi-error-inline">{submitError || instance.last_error}</div>
          ) : null}

          <div className="pi-postgen-actions">
            <button
              type="button"
              className="pi-primary-btn"
              onClick={() => void handleSubmit()}
              disabled={Boolean(submitting)}
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
            {!instance.required ? (
              <button
                type="button"
                className="pi-secondary-btn"
                onClick={() => void onSkip()}
                disabled={Boolean(submitting)}
              >
                Skip
              </button>
            ) : null}
            {instance.state === "failed" || instance.state === "timed_out" ? (
              <button
                type="button"
                className="pi-secondary-btn"
                onClick={() => void onRetry()}
                disabled={Boolean(submitting)}
              >
                Retry
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
