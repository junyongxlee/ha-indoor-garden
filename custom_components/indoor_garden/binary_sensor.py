"""Whether Auto mode currently wants lights on."""

from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, MODE_AUTO
from .controller import GrowZone
from .entity import IndoorGardenEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    zone: GrowZone = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([GrowZoneInSchedule(zone)])


class GrowZoneInSchedule(IndoorGardenEntity, BinarySensorEntity):
    """On when the photoperiod window is active."""

    _attr_device_class = BinarySensorDeviceClass.RUNNING
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_icon = "mdi:calendar-clock"

    def __init__(self, zone: GrowZone) -> None:
        super().__init__(zone, "in_schedule")
        self._attr_name = "In schedule"

    @property
    def is_on(self) -> bool:
        return self.zone.in_photoperiod()

    @property
    def extra_state_attributes(self) -> dict[str, str | bool | list[str]]:
        return {
            "mode": self.zone.mode,
            "desired_on": self.zone.desired_on(),
            "auto": self.zone.mode == MODE_AUTO,
            "entities": list(self.zone.entities),
        }
