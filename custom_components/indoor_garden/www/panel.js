const TAG = "indoor-garden-panel";

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

class IndoorGardenPanel extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  get hass() {
    return this._hass;
  }

  _call(entityId, domain, service, data) {
    this._hass.callService(domain, service, { entity_id: entityId, ...data });
  }

  _render() {
    const hass = this._hass;
    if (!hass) return;
    const zones = zoneEntities(hass);
    const devices = hass.devices || {};
    const focused = this._root.activeElement;
    const focusId = focused && focused.dataset ? focused.dataset.eid : null;

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
        .add {
          border: 0;
          border-radius: 20px;
          padding: 8px 14px;
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          cursor: pointer;
          font: inherit;
        }
        .empty {
          padding: 32px 16px;
          text-align: center;
          color: var(--secondary-text-color);
        }
        .grid {
          display: grid;
          gap: 12px;
        }
        ha-card, .card {
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
        select, input[type="time"] {
          border: 0;
          border-radius: 10px;
          background: var(--secondary-background-color, rgba(255,255,255,0.06));
          color: var(--primary-text-color);
          font: inherit;
          font-size: 1rem;
          padding: 10px 12px;
        }
        .entities { margin-top: 12px; font-size: 0.85rem; color: var(--secondary-text-color); }
        .gear {
          border: 0; background: transparent; color: var(--secondary-text-color);
          cursor: pointer; font-size: 1.2rem;
        }
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
    `;

    this._root.querySelector(".add").addEventListener("click", () => {
      history.pushState(null, "", "/config/integrations/dashboard/add?domain=indoor_garden");
      window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true, detail: { replace: false } }));
    });

    this._root.querySelectorAll("[data-mode]").forEach((el) => {
      el.addEventListener("change", () => this._call(el.dataset.mode, "select", "select_option", { option: el.value }));
    });
    this._root.querySelectorAll("[data-start]").forEach((el) => {
      el.addEventListener("change", () => this._call(el.dataset.start, "time", "set_value", { time: el.value + ":00" }));
    });
    this._root.querySelectorAll("[data-end]").forEach((el) => {
      el.addEventListener("change", () => this._call(el.dataset.end, "time", "set_value", { time: el.value + ":00" }));
    });
    this._root.querySelectorAll("[data-more]").forEach((el) => {
      el.addEventListener("click", () => this._more(el.dataset.more));
    });

    if (focusId) {
      const again = this._root.querySelector(`[data-eid="${focusId}"]`);
      if (again) again.focus();
    }
  }

  _more(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      })
    );
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
    const opts = options.map((o) => `<option value="${o}" ${mode && mode.state === o ? "selected" : ""}>${o}</option>`).join("");
    const lightNames = lights
      .map((id) => hass.states[id]?.attributes.friendly_name || id)
      .join(", ");
    return `
      <div class="card">
        <div class="top">
          <div>
            <div class="name">${name}</div>
            <div class="meta"><span class="dot ${desired ? "on" : ""}"></span>${desired ? "Lights should be on" : "Lights should be off"}${schedule && schedule.state === "on" ? " · in photoperiod" : ""}</div>
          </div>
          <button class="gear" type="button" data-more="${z.mode}" title="Zone details">⚙</button>
        </div>
        <div class="controls">
          <label>Mode
            <select data-mode="${z.mode}" data-eid="${z.mode}">${opts}</select>
          </label>
          <label>Start
            <input type="time" data-start="${z.start || ""}" data-eid="${z.start || ""}" value="${shortTime(start)}" />
          </label>
          <label>End
            <input type="time" data-end="${z.end || ""}" data-eid="${z.end || ""}" value="${shortTime(end)}" />
          </label>
        </div>
        <div class="entities">${lightNames ? "Controls: " + lightNames : "No lights assigned. Configure the zone to pick entities."}</div>
      </div>
    `;
  }
}

if (!customElements.get(TAG)) {
  customElements.define(TAG, IndoorGardenPanel);
}
