"""Admin websocket commands for managing grow zones from the panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import CONF_ENTITIES, DOMAIN

_CONTROL_DOMAINS = {"light", "switch"}


@callback
def async_register_websocket_handlers(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_update_zone)


def _zone_entry(hass: HomeAssistant, entry_id: str):
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None or entry.domain != DOMAIN:
        return None
    return entry


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "indoor_garden/update_zone",
        vol.Required("entry_id"): str,
        vol.Required("name"): str,
        vol.Required("entities"): vol.All([str], vol.Length(min=1)),
    }
)
@websocket_api.async_response
async def ws_update_zone(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Rename a zone and/or change the lights it controls."""
    entry = _zone_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Unknown zone")
        return

    name = str(msg["name"] or "").strip()
    entities = [item for item in msg["entities"] if item]
    if not name:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, "Enter a zone name.")
        return
    if not entities:
        connection.send_error(
            msg["id"], websocket_api.ERR_INVALID_FORMAT, "Pick at least one light or switch."
        )
        return
    if any(item.split(".", 1)[0] not in _CONTROL_DOMAINS for item in entities):
        connection.send_error(
            msg["id"],
            websocket_api.ERR_INVALID_FORMAT,
            "Zones can only control lights or switches.",
        )
        return

    hass.config_entries.async_update_entry(
        entry,
        title=name,
        data={"name": name, CONF_ENTITIES: entities},
    )
    connection.send_result(msg["id"])
