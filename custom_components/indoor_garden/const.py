"""Constants for Indoor Garden."""

from __future__ import annotations

from datetime import time
from typing import Final

from homeassistant.const import Platform

DOMAIN: Final = "indoor_garden"
PLATFORMS: Final = [Platform.BINARY_SENSOR, Platform.SELECT, Platform.TIME]

CONF_ENTITIES: Final = "entities"

MODE_OFF: Final = "Off"
MODE_ON: Final = "On"
MODE_AUTO: Final = "Auto"
MODES: Final = [MODE_OFF, MODE_ON, MODE_AUTO]

DEFAULT_START: Final = time(6, 0)
DEFAULT_END: Final = time(22, 0)
DEFAULT_MODE: Final = MODE_AUTO

PANEL_URL_PATH: Final = "indoor-garden"
PANEL_JS: Final = "/indoor_garden/panel.js"
CARD_JS: Final = "/indoor_garden/card.js"
STATIC_URL: Final = "/indoor_garden"

ATTR_ZONE: Final = "zone"
