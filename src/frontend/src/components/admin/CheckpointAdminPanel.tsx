import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createCheckpointDefinition,
  deleteCheckpointDefinition,
  listCheckpointDefinitions,
  listCheckpointFieldTypes,
  toggleCheckpointDefinition,
  updateCheckpointDefinition,
} from "../../api/client";
import type {
  CheckpointDefinitionCreateRequest,
  CheckpointDefinitionResponse,
  CheckpointDefinitionUpdateRequest,
  CheckpointFieldDefinition,
  CheckpointFieldTypeResponse,
  CheckpointPipelinePosition,
} from "../../types";

type EditorMode = "create" | "edit";

interface DefinitionFormState {
  controlType: string;
  label: string;
  description: string;
  pipelinePosition: CheckpointPipelinePosition;
  sortOrder: string;
  applicableModesCsv: string;
  required: boolean;
  timeoutSeconds: string;
  maxRetries: string;
  circuitBreakerThreshold: string;
  circuitBreakerWindowMinutes: string;
  enabled: boolean;
  fieldSchemaJson: string;
}

const DEFAULT_FIELD_SCHEMA = `[
  {
    "key": "notes",
    "type": "textarea",
    "label": "Notes",
    "required": false
  }
]`;

function createDefaultForm(): DefinitionFormState {
  return {
    controlType: "",
    label: "",
    description: "",
    pipelinePosition: "after_retrieval",
    sortOrder: "0",
    applicableModesCsv: "*",
    required: false,
    timeoutSeconds: "",
    maxRetries: "2",
    circuitBreakerThreshold: "5",
    circuitBreakerWindowMinutes: "60",
    enabled: true,
    fieldSchemaJson: DEFAULT_FIELD_SCHEMA,
  };
}

function modesToCsv(modes: string[]): string {
  if (modes.length === 0) {
    return "*";
  }
  return modes.join(", ");
}

function parseModes(csv: string): string[] {
  const values = csv
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length === 0 ? ["*"] : values;
}

function parseFieldSchema(json: string): CheckpointFieldDefinition[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Field schema JSON must be an array");
  }

  const fields = parsed.map((field, index) => {
    if (!field || typeof field !== "object") {
      throw new Error(`Field #${index + 1} must be an object`);
    }

    const record = field as Record<string, unknown>;
    if (typeof record.key !== "string" || record.key.trim() === "") {
      throw new Error(`Field #${index + 1} requires a non-empty 'key'`);
    }
    if (typeof record.type !== "string" || record.type.trim() === "") {
      throw new Error(`Field #${index + 1} requires a non-empty 'type'`);
    }
    if (typeof record.label !== "string" || record.label.trim() === "") {
      throw new Error(`Field #${index + 1} requires a non-empty 'label'`);
    }

    return record as unknown as CheckpointFieldDefinition;
  });

  return fields;
}

function toFormState(definition: CheckpointDefinitionResponse): DefinitionFormState {
  return {
    controlType: definition.control_type,
    label: definition.label,
    description: definition.description,
    pipelinePosition: definition.pipeline_position,
    sortOrder: String(definition.sort_order),
    applicableModesCsv: modesToCsv(definition.applicable_modes),
    required: definition.required,
    timeoutSeconds: definition.timeout_seconds === null ? "" : String(definition.timeout_seconds),
    maxRetries: String(definition.max_retries),
    circuitBreakerThreshold: String(definition.circuit_breaker_threshold),
    circuitBreakerWindowMinutes: String(definition.circuit_breaker_window_minutes),
    enabled: definition.enabled,
    fieldSchemaJson: JSON.stringify(definition.field_schema, null, 2),
  };
}

export default function CheckpointAdminPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [fieldTypes, setFieldTypes] = useState<CheckpointFieldTypeResponse[]>([]);
  const [definitions, setDefinitions] = useState<CheckpointDefinitionResponse[]>([]);
  const [mode, setMode] = useState<EditorMode>("create");
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null);
  const [form, setForm] = useState<DefinitionFormState>(createDefaultForm());

  const selectedDefinition = useMemo(
    () => definitions.find((definition) => definition.id === selectedDefinitionId) ?? null,
    [definitions, selectedDefinitionId]
  );

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [nextDefinitions, nextFieldTypes] = await Promise.all([
        listCheckpointDefinitions(false),
        listCheckpointFieldTypes(),
      ]);
      setDefinitions(nextDefinitions);
      setFieldTypes(nextFieldTypes);
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "Failed to load definitions";
      setError(messageText);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function resetToCreate() {
    setMode("create");
    setSelectedDefinitionId(null);
    setForm(createDefaultForm());
    setMessage("");
    setError("");
  }

  function startEdit(definition: CheckpointDefinitionResponse) {
    setMode("edit");
    setSelectedDefinitionId(definition.id);
    setForm(toFormState(definition));
    setMessage("");
    setError("");
  }

  function updateForm(patch: Partial<DefinitionFormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const fieldSchema = parseFieldSchema(form.fieldSchemaJson);
      const commonPayload: Omit<CheckpointDefinitionCreateRequest, "control_type"> = {
        label: form.label.trim(),
        description: form.description,
        field_schema: fieldSchema,
        pipeline_position: form.pipelinePosition,
        sort_order: Number.parseInt(form.sortOrder || "0", 10) || 0,
        applicable_modes: parseModes(form.applicableModesCsv),
        required: form.required,
        timeout_seconds:
          form.timeoutSeconds.trim() === ""
            ? null
            : Number.parseInt(form.timeoutSeconds, 10),
        max_retries: Number.parseInt(form.maxRetries || "2", 10) || 2,
        circuit_breaker_threshold:
          Number.parseInt(form.circuitBreakerThreshold || "5", 10) || 5,
        circuit_breaker_window_minutes:
          Number.parseInt(form.circuitBreakerWindowMinutes || "60", 10) || 60,
        enabled: form.enabled,
      };

      if (mode === "create") {
        if (!form.controlType.trim()) {
          throw new Error("control_type is required");
        }
        const payload: CheckpointDefinitionCreateRequest = {
          control_type: form.controlType.trim(),
          ...commonPayload,
        };
        const created = await createCheckpointDefinition(payload);
        setMessage(`Created '${created.control_type}'.`);
      } else {
        if (!selectedDefinitionId) {
          throw new Error("No definition selected for editing");
        }
        const payload: CheckpointDefinitionUpdateRequest = { ...commonPayload };
        const updated = await updateCheckpointDefinition(selectedDefinitionId, payload);
        setMessage(`Updated '${updated.control_type}'.`);
      }

      await loadData();
      if (mode === "create") {
        resetToCreate();
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        const messageText = caught instanceof Error ? caught.message : "Failed to save definition";
        setError(messageText);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(definition: CheckpointDefinitionResponse) {
    setError("");
    setMessage("");
    try {
      const updated = await toggleCheckpointDefinition(definition.id, !definition.enabled);
      setMessage(`${updated.control_type} is now ${updated.enabled ? "enabled" : "disabled"}.`);
      await loadData();
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "Toggle failed";
      setError(messageText);
    }
  }

  async function handleSoftDelete(definition: CheckpointDefinitionResponse) {
    setError("");
    setMessage("");
    try {
      const updated = await deleteCheckpointDefinition(definition.id);
      setMessage(`${updated.control_type} was disabled.`);
      await loadData();
      if (selectedDefinitionId === definition.id) {
        resetToCreate();
      }
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "Delete failed";
      setError(messageText);
    }
  }

  return (
    <section className="pi-admin-shell">
      <div className="pi-admin-header">
        <h2>Checkpoint Admin</h2>
        <div className="pi-admin-actions">
          <button className="pi-secondary-btn" type="button" onClick={() => void loadData()}>
            Refresh
          </button>
          <button className="pi-primary-btn" type="button" onClick={resetToCreate}>
            New Definition
          </button>
        </div>
      </div>

      {message ? <div className="pi-admin-banner success">{message}</div> : null}
      {error ? <div className="pi-admin-banner error">{error}</div> : null}

      <div className="pi-admin-grid">
        <aside className="pi-admin-list">
          <div className="pi-admin-section-title">Definitions</div>
          {loading ? <div className="pi-run-meta">Loading...</div> : null}
          {!loading && definitions.length === 0 ? (
            <div className="pi-run-meta">No checkpoint definitions found.</div>
          ) : null}
          {definitions.map((definition) => (
            <div key={definition.id} className="pi-admin-list-item">
              <div>
                <div className="pi-admin-item-title">{definition.label}</div>
                <div className="pi-admin-item-meta">
                  {definition.control_type} • {definition.pipeline_position}
                </div>
                <div className="pi-admin-item-meta">
                  {definition.enabled ? "enabled" : "disabled"} • sort {definition.sort_order}
                </div>
              </div>
              <div className="pi-admin-item-actions">
                <button type="button" className="pi-secondary-btn" onClick={() => startEdit(definition)}>
                  Edit
                </button>
                <button type="button" className="pi-secondary-btn" onClick={() => void handleToggle(definition)}>
                  {definition.enabled ? "Disable" : "Enable"}
                </button>
                <button type="button" className="pi-secondary-btn" onClick={() => void handleSoftDelete(definition)}>
                  Soft Delete
                </button>
              </div>
            </div>
          ))}
        </aside>

        <div className="pi-admin-editor">
          <div className="pi-admin-section-title">
            {mode === "create" ? "Create Definition" : `Edit Definition${selectedDefinition ? `: ${selectedDefinition.control_type}` : ""}`}
          </div>
          <form className="pi-admin-form" onSubmit={handleSubmit}>
            <label className="pi-form-label" htmlFor="admin-control-type">
              Control Type
            </label>
            <input
              id="admin-control-type"
              className="pi-form-control"
              value={form.controlType}
              onChange={(event) => updateForm({ controlType: event.target.value })}
              disabled={mode === "edit" || saving}
              placeholder="risk_priority_ranker"
            />

            <label className="pi-form-label" htmlFor="admin-label">
              Label
            </label>
            <input
              id="admin-label"
              className="pi-form-control"
              value={form.label}
              onChange={(event) => updateForm({ label: event.target.value })}
              disabled={saving}
            />

            <label className="pi-form-label" htmlFor="admin-description">
              Description
            </label>
            <textarea
              id="admin-description"
              className="pi-form-control pi-form-textarea"
              value={form.description}
              onChange={(event) => updateForm({ description: event.target.value })}
              disabled={saving}
              rows={3}
            />

            <div className="pi-admin-inline-grid">
              <div>
                <label className="pi-form-label" htmlFor="admin-pipeline">
                  Pipeline Position
                </label>
                <select
                  id="admin-pipeline"
                  className="pi-form-control"
                  value={form.pipelinePosition}
                  onChange={(event) =>
                    updateForm({ pipelinePosition: event.target.value as CheckpointPipelinePosition })
                  }
                  disabled={saving}
                >
                  <option value="after_retrieval">after_retrieval</option>
                  <option value="after_generation">after_generation</option>
                  <option value="post_generation">post_generation</option>
                </select>
              </div>

              <div>
                <label className="pi-form-label" htmlFor="admin-sort-order">
                  Sort Order
                </label>
                <input
                  id="admin-sort-order"
                  className="pi-form-control"
                  type="number"
                  value={form.sortOrder}
                  onChange={(event) => updateForm({ sortOrder: event.target.value })}
                  disabled={saving}
                />
              </div>
            </div>

            <label className="pi-form-label" htmlFor="admin-applicable-modes">
              Applicable Modes (CSV)
            </label>
            <input
              id="admin-applicable-modes"
              className="pi-form-control"
              value={form.applicableModesCsv}
              onChange={(event) => updateForm({ applicableModesCsv: event.target.value })}
              disabled={saving}
              placeholder="hitl_r,hitl_full or *"
            />

            <div className="pi-admin-inline-grid">
              <div>
                <label className="pi-form-label" htmlFor="admin-timeout">
                  Timeout Seconds
                </label>
                <input
                  id="admin-timeout"
                  className="pi-form-control"
                  type="number"
                  value={form.timeoutSeconds}
                  onChange={(event) => updateForm({ timeoutSeconds: event.target.value })}
                  disabled={saving}
                  placeholder="empty for none"
                />
              </div>

              <div>
                <label className="pi-form-label" htmlFor="admin-max-retries">
                  Max Retries
                </label>
                <input
                  id="admin-max-retries"
                  className="pi-form-control"
                  type="number"
                  value={form.maxRetries}
                  onChange={(event) => updateForm({ maxRetries: event.target.value })}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="pi-admin-inline-grid">
              <div>
                <label className="pi-form-label" htmlFor="admin-cb-threshold">
                  Circuit Breaker Threshold
                </label>
                <input
                  id="admin-cb-threshold"
                  className="pi-form-control"
                  type="number"
                  value={form.circuitBreakerThreshold}
                  onChange={(event) => updateForm({ circuitBreakerThreshold: event.target.value })}
                  disabled={saving}
                />
              </div>

              <div>
                <label className="pi-form-label" htmlFor="admin-cb-window">
                  Circuit Breaker Window (minutes)
                </label>
                <input
                  id="admin-cb-window"
                  className="pi-form-control"
                  type="number"
                  value={form.circuitBreakerWindowMinutes}
                  onChange={(event) =>
                    updateForm({ circuitBreakerWindowMinutes: event.target.value })
                  }
                  disabled={saving}
                />
              </div>
            </div>

            <label className="pi-option-item">
              <input
                type="checkbox"
                checked={form.required}
                onChange={(event) => updateForm({ required: event.target.checked })}
                disabled={saving}
              />
              <span>Required checkpoint</span>
            </label>

            <label className="pi-option-item">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => updateForm({ enabled: event.target.checked })}
                disabled={saving}
              />
              <span>Enabled</span>
            </label>

            <label className="pi-form-label" htmlFor="admin-field-schema">
              Field Schema JSON
            </label>
            <textarea
              id="admin-field-schema"
              className="pi-form-control pi-form-textarea pi-admin-json"
              value={form.fieldSchemaJson}
              onChange={(event) => updateForm({ fieldSchemaJson: event.target.value })}
              disabled={saving}
              rows={14}
            />

            <div className="pi-postgen-actions">
              <button type="submit" className="pi-primary-btn" disabled={saving}>
                {saving ? "Saving..." : mode === "create" ? "Create Definition" : "Save Changes"}
              </button>
              {mode === "edit" ? (
                <button type="button" className="pi-secondary-btn" onClick={resetToCreate} disabled={saving}>
                  Cancel Edit
                </button>
              ) : null}
            </div>
          </form>

          <div className="pi-admin-section-title">Supported Field Types</div>
          <div className="pi-admin-field-types">
            {fieldTypes.map((fieldType) => (
              <div key={fieldType.type} className="pi-admin-field-type">
                <div className="pi-admin-item-title">{fieldType.type}</div>
                <div className="pi-admin-item-meta">{fieldType.label}</div>
                <div className="pi-admin-item-meta">{fieldType.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
