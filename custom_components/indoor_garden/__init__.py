"""Indoor Garden: grouped grow-light zones without extra automations."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import Event, HomeAssistant
from homeassistant.helpers import config_validation as cv, device_registry as dr
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
    VERSION,
)
from .controller import GrowZone
from .websocket import async_register_websocket_handlers

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_STATIC_FLAG = f"{DOMAIN}_static"
_PANEL_FLAG = f"{DOMAIN}_panel"
_CARD_FLAG = f"{DOMAIN}_card"


async def async_setup(hass: HomeAssistant, _config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})
    async_register_websocket_handlers(hass)
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
    registry = dr.async_get(hass)
    device = registry.async_get_device(identifiers={(DOMAIN, entry.entry_id)})
    if device and device.name != zone.name:
        registry.async_update_device(device.id, name=zone.name)
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

        async def _register_card(_event: Event | None = None) -> None:
            await _async_register_lovelace_card(hass)

        # Lovelace resources must load through the dashboard resource pipeline.
        # frontend.add_extra_js_url races HA's scoped custom element registry and
        # intermittently yields "Configuration error" for custom:indoor-garden-card.
        if hass.is_running:
            await _register_card()
        else:
            hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _register_card)

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
            module_url=f"{PANEL_JS}?v={VERSION}",
            sidebar_title="Indoor Garden",
            sidebar_icon="mdi:sprout",
            require_admin=False,
            config={},
            config_panel_domain=DOMAIN,
        )
    except Exception:
        hass.data.pop(_PANEL_FLAG, None)
        raise


async def _async_register_lovelace_card(hass: HomeAssistant) -> None:
    """Register card.js as a Lovelace dashboard resource (storage mode).

    Loads the module through Lovelace's resource pipeline so the custom element
    is defined in the same registry dashboards use. Replaces any existing
    resource whose URL starts with CARD_JS (including older ?v= / &lovelace=
    variants) so the card is not loaded twice after an upgrade.
    """
    card_url = f"{CARD_JS}?v={VERSION}"
    lovelace = hass.data.get("lovelace")
    resources = getattr(lovelace, "resources", None)
    resource_mode = getattr(lovelace, "resource_mode", None)

    if resource_mode != "storage" or resources is None:
        _LOGGER.warning(
            "Indoor Garden could not auto-register the Lovelace card resource "
            "(YAML-mode Lovelace or Lovelace unavailable). Add a dashboard "
            "resource manually: url %s, type module",
            card_url,
        )
        return

    try:
        # Force lazy load before async_items/create — an empty collection + create
        # can overwrite lovelace_resources storage (HA core issue #165767).
        if not getattr(resources, "loaded", False):
            await resources.async_get_info()

        existing = [
            item
            for item in resources.async_items()
            if str(item.get("url", "")).startswith(CARD_JS)
        ]

        if existing:
            primary, *duplicates = existing
            if primary.get("url") != card_url or primary.get("type") != "module":
                await resources.async_update_item(
                    primary["id"],
                    {"res_type": "module", "url": card_url},
                )
            for dup in duplicates:
                await resources.async_delete_item(dup["id"])
            return

        await resources.async_create_item({"res_type": "module", "url": card_url})
    except Exception:  # noqa: BLE001
        _LOGGER.warning(
            "Could not register the Lovelace resource for Indoor Garden card; "
            "add it manually: url %s, type module",
            card_url,
            exc_info=True,
        )
