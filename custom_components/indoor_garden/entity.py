"""Shared entity helpers for Indoor Garden."""

from __future__ import annotations

import re

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_") or "zone"

from .const import DOMAIN
from .controller import GrowZone


class IndoorGardenEntity(Entity):
    """Base entity attached to a grow zone device."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, zone: GrowZone, key: str) -> None:
        self.zone = zone
        self._attr_unique_id = f"{zone.entry_id}_{key}"
        self._attr_translation_key = key
        self._attr_suggested_object_id = f"{_slug(zone.name)}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, zone.entry_id)},
            name=zone.name,
            manufacturer="Indoor Garden",
            model="Grow zone",
        )
        self._unsub = None

    async def async_added_to_hass(self) -> None:
        self._unsub = self.zone.subscribe(self._handle_zone_update)

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None

    def _handle_zone_update(self) -> None:
        self.async_write_ha_state()
