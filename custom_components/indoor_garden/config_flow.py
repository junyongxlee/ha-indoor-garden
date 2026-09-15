"""Config flow: pick a zone name and which lights/sockets belong to it."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    TextSelector,
)

from .const import CONF_ENTITIES, DOMAIN

ENTITY_SELECTOR = EntitySelector(
    EntitySelectorConfig(domain=["light", "switch"], multiple=True)
)


def _as_list(value: str | list[str]) -> list[str]:
    if isinstance(value, str):
        return [value]
    return list(value)


def _schema(defaults: dict[str, Any] | None = None) -> vol.Schema:
    defaults = defaults or {}
    name = vol.Required("name")
    entities = vol.Required(CONF_ENTITIES)
    if "name" in defaults:
        name = vol.Required("name", default=defaults["name"])
    if CONF_ENTITIES in defaults:
        entities = vol.Required(CONF_ENTITIES, default=defaults[CONF_ENTITIES])
    return vol.Schema(
        {
            name: TextSelector(),
            entities: ENTITY_SELECTOR,
        }
    )


class IndoorGardenConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add a grow zone."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return IndoorGardenOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        suggested: dict[str, Any] = {}
        if self.hass.states.get("switch.grow_lights_socket_1"):
            suggested[CONF_ENTITIES] = ["switch.grow_lights_socket_1"]
        if user_input is not None:
            name = str(user_input.get("name") or "").strip()
            entities = _as_list(user_input.get(CONF_ENTITIES) or [])
            if not name:
                errors["name"] = "invalid_name"
            elif not entities:
                errors[CONF_ENTITIES] = "no_entities"
            else:
                return self.async_create_entry(
                    title=name,
                    data={"name": name, CONF_ENTITIES: entities},
                )
            suggested = {"name": name, CONF_ENTITIES: entities}

        return self.async_show_form(
            step_id="user",
            data_schema=_schema(suggested),
            errors=errors,
        )


class IndoorGardenOptionsFlow(OptionsFlow):
    """Change zone name or lights later."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        entry = self.config_entry
        if user_input is not None:
            name = str(user_input.get("name") or "").strip()
            entities = _as_list(user_input.get(CONF_ENTITIES) or [])
            errors: dict[str, str] = {}
            if not name:
                errors["name"] = "invalid_name"
            if not entities:
                errors[CONF_ENTITIES] = "no_entities"
            if errors:
                return self.async_show_form(
                    step_id="init",
                    data_schema=_schema(user_input),
                    errors=errors,
                )
            self.hass.config_entries.async_update_entry(
                entry,
                title=name,
                data={"name": name, CONF_ENTITIES: entities},
            )
            return self.async_create_entry(title="", data={})

        current = {
            "name": entry.data.get("name", entry.title),
            CONF_ENTITIES: entry.data.get(CONF_ENTITIES, []),
        }
        return self.async_show_form(step_id="init", data_schema=_schema(current))
