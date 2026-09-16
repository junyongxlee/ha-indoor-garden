const TAG = "indoor-garden-panel";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function zoneEntities(hass) {
  const entities = hass.entities || {};
  const byDevice = {};
  for (const entityId of Object.keys(hass.states || {})) {
    const meta = entities[entityId];
    if (!meta || meta.platform !== "indoor_garden" || !meta.device_id) continue;
    const bucket = (byDevice[meta.device_id] ||= {});
    const domain = entityId.split(".")[0];
    if (domain === "select") bucket.mode = entityId;
    else if (domain === "time" && entityId.endsWith("_start")) bucket.start = entityId;
    else if (domain === "time" && entityId.endsWith("_end")) bucket.end = entityId;
    else if (domain === "binary_sensor") bucket.schedule = entityId;
  }
  return Object.values(byDevice).filter((z) => z.mode);
}

function shortTime(state) {
  if (!state || !state.state || state.state === "unknown") return "--:--";
  return String(state.state).slice(0, 5);
}

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function navigate(path) {
  history.pushState(null, "", path);
  window.dispatchEvent(
    new CustomEvent("location-changed", {
      bubbles: true,
      composed: true,
      detail: { replace: false },
    })
  );
}

function isControl(el) {
  return Boolean(el) && (el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

function zoneSignature(hass, zones) {
  return zones
    .map((z) => {
      const mode = hass.states[z.mode];
      const start = hass.states[z.start];
      const end = hass.states[z.end];
      const schedule = hass.states[z.schedule];
      const device = hass.devices?.[hass.entities?.[z.mode]?.device_id] || {};
      const lights = (schedule?.attributes?.entities || []).join(",");
      return [
        z.mode,
        z.start,
        z.end,
        mode?.state,
        start?.state,
        end?.state,
        schedule?.state,
        schedule?.attributes?.desired_on ? "1" : "0",
        lights,
        device.name_by_user || device.name || "",
      ].join("|");
    })
    .join(";");
}

class IndoorGardenPanel extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._editing = null;
    this._editError = "";
    this._busy = false;
    this._selectorEl = null;
    this._mounted = false;
    this._interacting = false;
    this._zoneIds = "";
    this._signature = "";
    this._root.addEventListener(
      "pointerdown",
      (ev) => {
        if (isControl(ev.target)) this._interacting = true;
      },
      true
    );
    this._root.addEventListener(
      "focusin",
      (ev) => {
        if (isControl(ev.target)) this._interacting = true;
      },
      true
    );
    this._root.addEventListener("focusout", (ev) => {
      const next = ev.relatedTarget;
      if (isControl(next) && this._root.contains(next)) return;
      if (!this._interacting) return;
      this._interacting = false;
      this._sync();
    });
  }

  set hass(hass) {
    this._hass = hass;
    if (this._editing) {
      if (this._selectorEl) this._selectorEl.hass = hass;
      return;
    }
    if (this._interacting) return;
    this._sync();
  }

  get hass() {
    return this._hass;
  }

  _call(entityId, domain, service, data) {
    this._hass.callService(domain, service, { entity_id: entityId, ...data });
  }

  _isAdmin() {
    return Boolean(this._hass?.user?.is_admin);
  }

  _entryId(modeEntityId) {
    const unique = this._hass.entities[modeEntityId]?.unique_id || "";
    return unique.endsWith("_mode") ? unique.slice(0, -5) : unique;
  }

  _sync() {
    const hass = this._hass;
    if (!hass) return;
    const zones = zoneEntities(hass);
    const ids = zones.map((z) => z.mode).join(",");
    const signature = zoneSignature(hass, zones);
    if (!this._mounted || ids !== this._zoneIds) {
      this._zoneIds = ids;
      this._signature = signature;
      this._render();
      return;
    }
    if (signature === this._signature) return;
    this._signature = signature;
    this._patch(zones);
  }

  _patch(zones) {
    const hass = this._hass;
    const devices = hass.devices || {};
    const active = this._root.activeElement;
    for (const z of zones) {
      const card = this._root.querySelector(`[data-card="${CSS.escape(z.mode)}"]`);
      if (!card) {
        this._render();
        return;
      }
      const mode = hass.states[z.mode];
      const start = hass.states[z.start];
      const end = hass.states[z.end];
      const schedule = hass.states[z.schedule];
      const device = devices[hass.entities[z.mode]?.device_id] || {};
      const name = device.name_by_user || device.name || (mode && mode.attributes.friendly_name) || "Grow zone";
      const lights = (schedule && schedule.attributes.entities) || [];
      const desired = !!(schedule && schedule.attributes.desired_on);
      const lightNames = lights.map((id) => hass.states[id]?.attributes.friendly_name || id).join(", ");
      const modeEl = card.querySelector("[data-mode]");
      const startEl = card.querySelector("[data-start]");
      const endEl = card.querySelector("[data-end]");
      if (modeEl && modeEl !== active && mode && modeEl.value !== mode.state) modeEl.value = mode.state;
      if (startEl && startEl !== active) {
        const value = shortTime(start);
        if (startEl.value !== value) startEl.value = value;
      }
      if (endEl && endEl !== active) {
        const value = shortTime(end);
        if (endEl.value !== value) endEl.value = value;
      }
      const nameEl = card.querySelector("[data-name]");
      if (nameEl) nameEl.textContent = name;
      const metaEl = card.querySelector("[data-meta]");
      if (metaEl) {
        metaEl.innerHTML = `<span class="dot ${desired ? "on" : ""}"></span>${
          desired ? "Lights should be on" : "Lights should be off"
        }${schedule && schedule.state === "on" ? " · in photoperiod" : ""}`;
      }
      const lightsEl = card.querySelector("[data-lights]");
      if (lightsEl) lightsEl.textContent = lightNames ? `Controls: ${lightNames}` : "No lights assigned.";
    }
  }

  _render() {
    const hass = this._hass;
    if (!hass) return;
    const zones = zoneEntities(hass);
    const devices = hass.devices || {};
    this._mounted = true;
    this._zoneIds = zones.map((z) => z.mode).join(",");
    this._signature = zoneSignature(hass, zones);

    this._root.innerHTML = `
      <style>
        :host { display: block; }
        .wrap {
          max-width: 920px;
          margin: 0 auto;
          padding: 16px;
        }
        header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
        }
        h1 {
          font-size: 1.6rem;
          font-weight: 500;
          margin: 0;
        }
        .sub { color: var(--secondary-text-color); margin: 4px 0 0; }
        .add, .primary, .danger, .ghost {
          border: 0;
          border-radius: 20px;
          padding: 8px 14px;
          cursor: pointer;
          font: inherit;
        }
        .add, .primary {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }
        .danger {
          background: var(--error-color, #db4437);
          color: #fff;
        }
        .ghost {
          background: transparent;
          color: var(--primary-color);
        }
        button:disabled { opacity: 0.6; cursor: default; }
        .empty {
          padding: 32px 16px;
          text-align: center;
          color: var(--secondary-text-color);
        }
        .grid { display: grid; gap: 12px; }
        .card {
          background: var(--card-background-color, var(--ha-card-background));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow);
          border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color));
          padding: 16px;
        }
        .top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .name { font-size: 1.15rem; font-weight: 600; }
        .meta { color: var(--secondary-text-color); font-size: 0.85rem; margin-top: 4px; }
        .dot {
          width: 10px; height: 10px; border-radius: 50%;
          background: var(--disabled-color);
          display: inline-block; margin-right: 6px;
        }
        .dot.on { background: var(--success-color, #4caf50); }
        .controls {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px;
          margin-top: 14px;
        }
        @media (max-width: 700px) {
          .controls { grid-template-columns: 1fr; }
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 0.8rem;
          color: var(--secondary-text-color);
        }
        select, input[type="time"], input[type="text"] {
          border: 0;
          border-radius: 10px;
          background: var(--secondary-background-color, rgba(255,255,255,0.06));
          color: var(--primary-text-color);
          font: inherit;
          font-size: 1rem;
          padding: 10px 12px;
        }
        .entities { margin-top: 12px; font-size: 0.85rem; color: var(--secondary-text-color); }
        .entities button {
          border: 0; background: transparent; color: var(--primary-color);
          cursor: pointer; font: inherit; padding: 0 0 0 8px;
        }
        .gear, .edit {
          border: 0; background: transparent; color: var(--secondary-text-color);
          cursor: pointer; font-size: 0.9rem;
        }
        .edit { color: var(--primary-color); }
        .backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.45);
          display: flex; align-items: flex-start; justify-content: center;
          padding: 48px 16px;
          overflow: auto;
          z-index: 8;
        }
        .dialog {
          width: min(560px, 100%);
          overflow: visible;
        }
        .dialog h2 { margin: 0 0 4px; font-size: 1.25rem; font-weight: 600; }
        .hint { color: var(--secondary-text-color); font-size: 0.85rem; margin: 0 0 16px; }
        .field { margin-bottom: 14px; overflow: visible; }
        .error { color: var(--error-color, #db4437); font-size: 0.85rem; margin: 8px 0; }
        .actions {
          display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end;
          margin-top: 18px;
        }
        .actions .danger { margin-right: auto; }
      </style>
      <div class="wrap">
        <header>
          <div>
            <h1>Indoor Garden</h1>
            <p class="sub">Grow lights, grouped. Each zone has its own schedule.</p>
          </div>
          <button class="add" type="button">Add zone</button>
        </header>
        ${
          zones.length
            ? `<div class="grid">${zones
                .map((z) => this._card(hass, devices, z))
                .join("")}</div>`
            : `<div class="card empty">No grow zones yet. Add a zone and pick the lights or sockets it should control.</div>`
        }
      </div>
      ${this._editing ? this._dialogHtml() : ""}
    `;

    this._root.querySelector(".add")?.addEventListener("click", () => {
      navigate("/config/integrations/dashboard/add?domain=indoor_garden");
    });
    this._root.querySelectorAll("[data-mode]").forEach((el) => {
      el.addEventListener("change", () =>
        this._call(el.dataset.mode, "select", "select_option", { option: el.value })
      );
    });
    this._root.querySelectorAll("[data-start]").forEach((el) => {
      el.addEventListener("change", () =>
        this._call(el.dataset.start, "time", "set_value", { time: `${el.value}:00` })
      );
    });
    this._root.querySelectorAll("[data-end]").forEach((el) => {
      el.addEventListener("change", () =>
        this._call(el.dataset.end, "time", "set_value", { time: `${el.value}:00` })
      );
    });
    this._root.querySelectorAll("[data-edit]").forEach((el) => {
      el.addEventListener("click", () => this._openEdit(el.dataset.edit));
    });
    this._bindDialog();
  }

  _dialogHtml() {
    const name = escapeHtml(this._editing.name);
    const busy = this._busy ? "disabled" : "";
    return `
      <div class="backdrop" data-backdrop>
        <div class="card dialog" role="dialog" aria-labelledby="ig-edit-title">
          <h2 id="ig-edit-title">Manage zone</h2>
          <p class="hint">Rename this zone or choose which lights and sockets it controls. Mode and times stay on the card.</p>
          <div class="field">
            <label>Zone name
              <input type="text" data-zone-name data-eid="zone-name" value="${name}" ${busy} />
            </label>
          </div>
          <div class="field">
            <label>Lights and sockets</label>
            <div data-entity-picker></div>
          </div>
          ${this._editError ? `<div class="error">${escapeHtml(this._editError)}</div>` : ""}
          <div class="actions">
            <button class="danger" type="button" data-delete ${busy}>Delete zone</button>
            <button class="ghost" type="button" data-cancel ${busy}>Cancel</button>
            <button class="primary" type="button" data-save ${busy}>Save</button>
          </div>
        </div>
      </div>
    `;
  }

  _bindDialog() {
    if (!this._editing) {
      this._selectorEl = null;
      return;
    }
    const nameInput = this._root.querySelector("[data-zone-name]");
    nameInput?.addEventListener("input", () => {
      this._editing.name = nameInput.value;
    });
    this._root.querySelector("[data-cancel]")?.addEventListener("click", () => this._closeEdit());
    this._root.querySelector("[data-backdrop]")?.addEventListener("click", (ev) => {
      if (ev.target?.dataset?.backdrop !== undefined) this._closeEdit();
    });
    this._root.querySelector("[data-save]")?.addEventListener("click", () => this._saveEdit());
    this._root.querySelector("[data-delete]")?.addEventListener("click", () => this._deleteEdit());
    this._mountSelector();
  }

  _mountSelector() {
    const host = this._root.querySelector("[data-entity-picker]");
    if (!host) return;
    host.innerHTML = "";
    if (customElements.get("ha-selector")) {
      const el = document.createElement("ha-selector");
      el.hass = this._hass;
      el.selector = {
        entity: {
          multiple: true,
          domain: ["light", "switch"],
        },
      };
      el.value = this._editing.entities;
      el.label = "Grow lights";
      el.helper = "Pick devices or entities. Diagnostic switches such as child lock stay out of this list unless you search for them.";
      el.addEventListener("value-changed", (ev) => {
        this._editing.entities = asList(ev.detail?.value);
      });
      host.appendChild(el);
      this._selectorEl = el;
      return;
    }
    this._selectorEl = null;
    const options = Object.keys(this._hass.states)
      .filter((id) => id.startsWith("light.") || id.startsWith("switch."))
      .filter((id) => {
        const meta = this._hass.entities[id];
        return !meta?.entity_category;
      })
      .map((id) => {
        const selected = this._editing.entities.includes(id) ? "selected" : "";
        const label = this._hass.states[id]?.attributes?.friendly_name || id;
        return `<option value="${escapeHtml(id)}" ${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
    host.innerHTML = `<select multiple size="8" data-entity-fallback>${options}</select>`;
    host.querySelector("select")?.addEventListener("change", (ev) => {
      this._editing.entities = [...ev.target.selectedOptions].map((opt) => opt.value);
    });
  }

  _zoneByMode(modeId) {
    return zoneEntities(this._hass).find((z) => z.mode === modeId);
  }

  _openEdit(modeId) {
    if (!this._isAdmin()) {
      navigate("/config/integrations/integration/indoor_garden");
      return;
    }
    const z = this._zoneByMode(modeId);
    if (!z) return;
    const schedule = this._hass.states[z.schedule];
    const device = this._hass.devices[this._hass.entities[z.mode]?.device_id] || {};
    this._editing = {
      modeId,
      entryId: this._entryId(z.mode),
      name: device.name_by_user || device.name || "",
      entities: asList(schedule?.attributes?.entities),
    };
    this._editError = "";
    this._busy = false;
    this._render();
  }

  _closeEdit() {
    this._editing = null;
    this._editError = "";
    this._busy = false;
    this._selectorEl = null;
    this._render();
  }

  async _saveEdit() {
    if (!this._editing || this._busy) return;
    const name = (this._editing.name || "").trim();
    const entities = asList(this._selectorEl?.value || this._editing.entities);
    this._editing.entities = entities;
    if (!name) {
      this._editError = "Enter a zone name.";
      this._render();
      return;
    }
    if (!entities.length) {
      this._editError = "Pick at least one light or switch.";
      this._render();
      return;
    }
    this._busy = true;
    this._editError = "";
    this._render();
    try {
      await this._hass.callWS({
        type: "indoor_garden/update_zone",
        entry_id: this._editing.entryId,
        name,
        entities,
      });
      this._closeEdit();
    } catch (err) {
      this._editError = err?.message || "Could not save this zone.";
      this._busy = false;
      this._render();
    }
  }

  async _deleteEdit() {
    if (!this._editing || this._busy) return;
    const name = this._editing.name || "this zone";
    if (
      !window.confirm(
        `Delete “${name}”? The lights and sockets stay in Home Assistant. Only this Indoor Garden zone and its schedule are removed.`
      )
    ) {
      return;
    }
    this._busy = true;
    this._editError = "";
    this._render();
    try {
      await this._hass.callWS({
        type: "config_entries/delete",
        entry_id: this._editing.entryId,
      });
      this._closeEdit();
    } catch (err) {
      this._editError = err?.message || "Could not delete this zone.";
      this._busy = false;
      this._render();
    }
  }

  _card(hass, devices, z) {
    const mode = hass.states[z.mode];
    const start = hass.states[z.start];
    const end = hass.states[z.end];
    const schedule = hass.states[z.schedule];
    const device = devices[hass.entities[z.mode]?.device_id] || {};
    const name = device.name_by_user || device.name || (mode && mode.attributes.friendly_name) || "Grow zone";
    const lights = (schedule && schedule.attributes.entities) || [];
    const desired = !!(schedule && schedule.attributes.desired_on);
    const options = (mode && mode.attributes.options) || ["Off", "On", "Auto"];
    const opts = options
      .map(
        (o) =>
          `<option value="${escapeHtml(o)}" ${mode && mode.state === o ? "selected" : ""}>${escapeHtml(o)}</option>`
      )
      .join("");
    const lightNames = lights
      .map((id) => hass.states[id]?.attributes.friendly_name || id)
      .join(", ");
    return `
      <div class="card" data-card="${escapeHtml(z.mode)}">
        <div class="top">
          <div>
            <div class="name" data-name>${escapeHtml(name)}</div>
            <div class="meta" data-meta><span class="dot ${desired ? "on" : ""}"></span>${
              desired ? "Lights should be on" : "Lights should be off"
            }${schedule && schedule.state === "on" ? " · in photoperiod" : ""}</div>
          </div>
          <button class="edit" type="button" data-edit="${escapeHtml(z.mode)}">Edit zone</button>
        </div>
        <div class="controls">
          <label>Mode
            <select data-mode="${escapeHtml(z.mode)}" data-eid="${escapeHtml(z.mode)}">${opts}</select>
          </label>
          <label>Start
            <input type="time" data-start="${escapeHtml(z.start || "")}" data-eid="${escapeHtml(z.start || "")}" value="${shortTime(start)}" />
          </label>
          <label>End
            <input type="time" data-end="${escapeHtml(z.end || "")}" data-eid="${escapeHtml(z.end || "")}" value="${shortTime(end)}" />
          </label>
        </div>
        <div class="entities"><span data-lights>${
          lightNames ? `Controls: ${escapeHtml(lightNames)}` : "No lights assigned."
        }</span><button type="button" data-edit="${escapeHtml(z.mode)}">Change</button></div>
      </div>
    `;
  }
}

if (!customElements.get(TAG)) {
  customElements.define(TAG, IndoorGardenPanel);
}
