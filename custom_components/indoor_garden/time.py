"""Photoperiod start and end times for a grow zone."""

from __future__ import annotations

from datetime import time

from homeassistant.components.time import TimeEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DEFAULT_END, DEFAULT_START, DOMAIN
from .controller import GrowZone
from .entity import IndoorGardenEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    zone: GrowZone = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            GrowZoneTime(zone, "start", "Start", DEFAULT_START, "mdi:weather-sunset-up"),
            GrowZoneTime(zone, "end", "End", DEFAULT_END, "mdi:weather-sunset-down"),
        ]
    )


def _parse_time(value: str | None, fallback: time) -> time:
    if not value:
        return fallback
    try:
        parts = value.split(":")
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        second = int(float(parts[2])) if len(parts) > 2 else 0
        return time(hour, minute, second)
    except (TypeError, ValueError):
        return fallback


class GrowZoneTime(IndoorGardenEntity, TimeEntity, RestoreEntity):
    """Editable photoperiod boundary."""

    _attr_entity_category = EntityCategory.CONFIG

    def __init__(
        self,
        zone: GrowZone,
        key: str,
        name: str,
        default: time,
        icon: str,
    ) -> None:
        super().__init__(zone, key)
        self._key = key
        self._default = default
        self._attr_name = name
        self._attr_icon = icon
        self._attr_native_value = default
        if key == "start":
            zone.start = default
        else:
            zone.end = default

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last = await self.async_get_last_state()
        restored = _parse_time(last.state if last else None, self._default)
        await self.async_set_value(restored)

    @property
    def native_value(self) -> time | None:
        return self.zone.start if self._key == "start" else self.zone.end

    async def async_set_value(self, value: time) -> None:
        if self._key == "start":
            await self.zone.async_set_start(value)
        else:
            await self.zone.async_set_end(value)
        self._attr_native_value = value
        self.async_write_ha_state()
