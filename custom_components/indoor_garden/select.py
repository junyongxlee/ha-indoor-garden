"""Off / On / Auto mode for a grow zone."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DEFAULT_MODE, DOMAIN, MODES
from .controller import GrowZone
from .entity import IndoorGardenEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    zone: GrowZone = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([GrowZoneModeSelect(zone)])


class GrowZoneModeSelect(IndoorGardenEntity, SelectEntity, RestoreEntity):
    """Primary control for a grow zone."""

    _attr_options = list(MODES)
    _attr_icon = "mdi:sprout"

    def __init__(self, zone: GrowZone) -> None:
        super().__init__(zone, "mode")
        self._attr_name = "Mode"
        self._attr_current_option = zone.mode

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last = await self.async_get_last_state()
        option = last.state if last and last.state in MODES else DEFAULT_MODE
        self.zone.mode = option
        self._attr_current_option = option

    @property
    def current_option(self) -> str | None:
        return self.zone.mode

    async def async_select_option(self, option: str) -> None:
        await self.zone.async_set_mode(option)
        self._attr_current_option = option
        self.async_write_ha_state()
