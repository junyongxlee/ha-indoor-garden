# Changelog

## 0.2.3

### Fixed

- **Lovelace card “Configuration error”** — `custom:indoor-garden-card` was
  registered with `frontend.add_extra_js_url`, which can define the custom
  element before Home Assistant swaps in its scoped custom element registry.
  Dashboards then fail to find the card (especially on mobile / Companion and
  when `card.js` is cached). The card is now registered as a Lovelace dashboard
  resource (storage mode) so it loads through the same pipeline as other custom
  cards. YAML-mode installs get a log message with the URL to add manually.

### Changed

- Static path `/indoor_garden/card.js` is unchanged; only how the frontend
  imports it changed.
- On setup, any existing resource whose URL starts with `/indoor_garden/card.js`
  (including older `?v=0.2.2` / `&lovelace=1` entries) is updated or removed so
  the card is not loaded twice after upgrading from 0.2.2.

## 0.2.2

Prior release.