"""Per-zone grow-light scheduler. Replaces a pile of automations."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, time, timedelta
from typing import Any

from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_change,
)
from homeassistant.util import dt as dt_util

from .const import MODE_AUTO, MODE_OFF, MODE_ON

_LOGGER = logging.getLogger(__name__)

_RESTORE_GRACE = timedelta(seconds=2)
_STARTUP_DELAY = 5

Listener = Callable[[], None]


class GrowZone:
    """One named grow zone: lights + Off/On/Auto photoperiod."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry_id: str,
        name: str,
        entities: list[str],
    ) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.name = name
        self.entities = list(entities)
        self.mode = MODE_AUTO
        self.start = time(6, 0)
        self.end = time(22, 0)
        self._unsubs: list[CALLBACK_TYPE] = []
        self._time_unsubs: list[CALLBACK_TYPE] = []
        self._state_unsub: CALLBACK_TYPE | None = None
        self._ignore_until: datetime | None = None
        self._listeners: list[Listener] = []

    def subscribe(self, listener: Listener) -> CALLBACK_TYPE:
        """Register a UI/entity update callback. Returns unsubscribe."""
        self._listeners.append(listener)

        def _unsub() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return _unsub

    def _notify(self) -> None:
        for listener in list(self._listeners):
            listener()

    def in_photoperiod(self, now: time | None = None) -> bool:
        """True when Auto should have lights on."""
        current = now or dt_util.now().time().replace(microsecond=0)
        start, end = self.start, self.end
        if start == end:
            return True
        if start < end:
            return start <= current < end
        return current >= start or current < end

    def desired_on(self) -> bool:
        if self.mode == MODE_ON:
            return True
        if self.mode == MODE_OFF:
            return False
        return self.in_photoperiod()

    async def async_set_mode(self, mode: str) -> None:
        if mode not in (MODE_OFF, MODE_ON, MODE_AUTO):
            return
        self.mode = mode
        self._notify()
        await self.async_apply()

    async def async_set_start(self, value: time) -> None:
        self.start = value.replace(microsecond=0)
        self._notify()
        self._reschedule()
        await self.async_apply()

    async def async_set_end(self, value: time) -> None:
        self.end = value.replace(microsecond=0)
        self._notify()
        self._reschedule()
        await self.async_apply()

    def update_entities(self, entities: list[str]) -> None:
        self.entities = list(entities)
        self._track_lights()
        self._notify()

    async def async_apply(self) -> None:
        if not self.entities:
            return
        service = "turn_on" if self.desired_on() else "turn_off"
        self._ignore_until = dt_util.utcnow() + _RESTORE_GRACE
        try:
            await self.hass.services.async_call(
                "homeassistant",
                service,
                {"entity_id": list(self.entities)},
                blocking=False,
            )
        except Exception:  # noqa: BLE001
            _LOGGER.exception("Indoor Garden failed to %s for %s", service, self.name)

    async def async_start(self) -> None:
        self._reschedule()
        self._track_lights()
        if self.hass.is_running:
            await self.async_apply()
        else:
            self._unsubs.append(
                self.hass.bus.async_listen_once(
                    EVENT_HOMEASSISTANT_STARTED, self._on_hass_started
                )
            )

    async def async_stop(self) -> None:
        self._clear_time()
        if self._state_unsub:
            self._state_unsub()
            self._state_unsub = None
        while self._unsubs:
            self._unsubs.pop()()

    @callback
    def _on_hass_started(self, _event: Event) -> None:
        async_call_later(self.hass, _STARTUP_DELAY, self._startup_apply)

    async def _startup_apply(self, _now: datetime) -> None:
        await self.async_apply()

    def _reschedule(self) -> None:
        self._clear_time()
        self._time_unsubs.append(
            async_track_time_change(
                self.hass,
                self._on_clock,
                hour=self.start.hour,
                minute=self.start.minute,
                second=self.start.second,
            )
        )
        self._time_unsubs.append(
            async_track_time_change(
                self.hass,
                self._on_clock,
                hour=self.end.hour,
                minute=self.end.minute,
                second=self.end.second,
            )
        )

    def _track_lights(self) -> None:
        if self._state_unsub:
            self._state_unsub()
            self._state_unsub = None
        if not self.entities:
            return
        self._state_unsub = async_track_state_change_event(
            self.hass, self.entities, self._on_light_event
        )

    def _clear_time(self) -> None:
        while self._time_unsubs:
            self._time_unsubs.pop()()

    async def _on_clock(self, _now: datetime) -> None:
        await self.async_apply()
        self._notify()

    async def _on_light_event(self, event: Event[dict[str, Any]]) -> None:
        if self._ignore_until and dt_util.utcnow() < self._ignore_until:
            return
        new = event.data.get("new_state")
        if new is None:
            return
        should_on = self.desired_on()
        is_on = new.state == "on"
        if should_on == is_on:
            self._notify()
            return
        _LOGGER.debug(
            "Indoor Garden restoring %s after unexpected %s",
            self.name,
            new.entity_id,
        )
        await self.async_apply()
        self._notify()
