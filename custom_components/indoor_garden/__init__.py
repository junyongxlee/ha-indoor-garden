"""Indoor Garden: grouped grow-light zones without extra automations."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.setup import async_setup_component

from .const import (
    CARD_JS,
    CONF_ENTITIES,
    DOMAIN,
    PANEL_JS,
    PANEL_URL_PATH,
    PLATFORMS,
    STATIC_URL,
)
from .controller import GrowZone

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_STATIC_FLAG = f"{DOMAIN}_static"
_PANEL_FLAG = f"{DOMAIN}_panel"
_CARD_FLAG = f"{DOMAIN}_card"


async def async_setup(hass: HomeAssistant, _config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await _async_register_frontend(hass)

    zone = GrowZone(
        hass,
        entry.entry_id,
        entry.data.get("name", entry.title),
        list(entry.data.get(CONF_ENTITIES, [])),
    )
    hass.data[DOMAIN][entry.entry_id] = zone
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await zone.async_start()
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    zone = hass.data[DOMAIN].pop(entry.entry_id, None)
    if isinstance(zone, GrowZone):
        await zone.async_stop()
    still_loaded = any(
        item.entry_id != entry.entry_id and item.state == ConfigEntryState.LOADED
        for item in hass.config_entries.async_entries(DOMAIN)
    )
    if unload_ok and not still_loaded and hass.data.get(_PANEL_FLAG):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
        hass.data.pop(_PANEL_FLAG, None)
    return unload_ok


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    zone = hass.data[DOMAIN].get(entry.entry_id)
    if not isinstance(zone, GrowZone):
        await hass.config_entries.async_reload(entry.entry_id)
        return
    zone.name = entry.data.get("name", entry.title)
    zone.update_entities(list(entry.data.get(CONF_ENTITIES, [])))
    await zone.async_apply()


async def _async_register_frontend(hass: HomeAssistant) -> None:
    www = Path(__file__).parent / "www"
    if not hass.data.get(_STATIC_FLAG) and www.is_dir():
        hass.data[_STATIC_FLAG] = True
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(www), False)]
        )

    if not hass.data.get(_CARD_FLAG):
        hass.data[_CARD_FLAG] = True
        try:
            frontend.add_extra_js_url(hass, f"{CARD_JS}?v=0.1.0")
        except Exception:  # noqa: BLE001
            hass.data.pop(_CARD_FLAG, None)
            _LOGGER.debug("Could not register Indoor Garden Lovelace module")

    if hass.data.get(_PANEL_FLAG):
        return
    hass.data[_PANEL_FLAG] = True
    try:
        if "panel_custom" not in hass.config.components:
            await async_setup_component(hass, "panel_custom", {})
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name="indoor-garden-panel",
            frontend_url_path=PANEL_URL_PATH,
            module_url=f"{PANEL_JS}?v=0.1.0",
            sidebar_title="Indoor Garden",
            sidebar_icon="mdi:sprout",
            require_admin=False,
            config={},
            config_panel_domain=DOMAIN,
        )
    except Exception:
        hass.data.pop(_PANEL_FLAG, None)
        raise
