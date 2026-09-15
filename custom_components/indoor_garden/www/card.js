class IndoorGardenCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = config || {};
  }

  getCardSize() {
    return 3;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _zones() {
    const hass = this._hass;
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

  _render() {
    if (!this._hass) return;
    if (!this._root) {
      this._root = this.attachShadow({ mode: "open" });
    }
    const zones = this._zones();
    const devices = this._hass.devices || {};
    this._root.innerHTML = `
      <style>
        ha-card { padding: 4px 0 8px; }
        .head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 16px 8px;
        }
        .title { font-weight: 600; }
        .open {
          border: 0; background: transparent; color: var(--primary-color);
          cursor: pointer; font: inherit;
        }
        .row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 16px;
        }
        .name { flex: 1; min-width: 0; font-weight: 500; }
        .status { color: var(--secondary-text-color); font-size: 0.8rem; }
        select, input[type="time"] {
          border: 0; border-radius: 16px;
          background: var(--secondary-background-color, rgba(255,255,255,0.06));
          color: var(--primary-text-color); font: inherit; padding: 6px 10px;
        }
        .empty { padding: 16px; color: var(--secondary-text-color); }
      </style>
      <ha-card>
        <div class="head">
          <div class="title">Indoor Garden</div>
          <button class="open" type="button">Open panel</button>
        </div>
        ${
          zones.length
            ? zones
                .map((z) => {
                  const mode = this._hass.states[z.mode];
                  const start = this._hass.states[z.start];
                  const end = this._hass.states[z.end];
                  const device = devices[this._hass.entities[z.mode]?.device_id] || {};
                  const name = device.name_by_user || device.name || "Grow zone";
                  const options = (mode?.attributes.options || ["Off", "On", "Auto"])
                    .map((o) => `<option ${mode && mode.state === o ? "selected" : ""}>${o}</option>`)
                    .join("");
                  const st = (start?.state || "").slice(0, 5);
                  const en = (end?.state || "").slice(0, 5);
                  return `<div class="row">
                    <div>
                      <div class="name">${name}</div>
                      <div class="status">${st}–${en}</div>
                    </div>
                    <select data-mode="${z.mode}">${options}</select>
                  </div>`;
                })
                .join("")
            : `<div class="empty">Add a grow zone from Indoor Garden in Settings.</div>`
        }
      </ha-card>
    `;
    this._root.querySelector(".open")?.addEventListener("click", () => {
      history.pushState(null, "", "/indoor-garden");
      window.dispatchEvent(
        new CustomEvent("location-changed", {
          bubbles: true,
          composed: true,
          detail: { replace: false },
        })
      );
    });
    this._root.querySelectorAll("[data-mode]").forEach((el) => {
      el.addEventListener("change", () => {
        this._hass.callService("select", "select_option", {
          entity_id: el.dataset.mode,
          option: el.value,
        });
      });
    });
  }
}

if (!customElements.get("indoor-garden-card")) {
  customElements.define("indoor-garden-card", IndoorGardenCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "indoor-garden-card")) {
  window.customCards.push({
    type: "indoor-garden-card",
    name: "Indoor Garden",
    description: "Grow zones with Off / On / Auto schedules",
  });
}
