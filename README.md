# Indoor Garden

A Home Assistant integration that groups grow lights into **zones**. Each zone is one device you manage together: pick the lights or sockets, then give that zone its own Off / On / Auto photoperiod.

This is meant to replace a stack of helpers and automations. The integration runs the schedule itself. Leave Home and similar “all off” flows can still touch the sockets; Indoor Garden puts them back.

## What you get

- **Sidebar panel** — Indoor Garden: all zones, mode, start/end, which entities belong to each zone
- **Settings → Devices & Services → Indoor Garden** — add a zone and choose lights
- **Multiple zones** — different photoperiods for different lights (seedlings vs mature, rack A vs rack B)
- **Mode**
  - **Off** — stays off
  - **On** — stays on
  - **Auto** — follows Start and End (overnight ranges such as 20:00–08:00 work)
- **Lovelace card** `custom:indoor-garden-card` for a dashboard

## Install with HACS

The repo is not in the default HACS store. Add it as a **custom repository**:

1. HACS → **⋯** → **Custom repositories**
2. Repository: `https://github.com/junyongxlee/ha-indoor-garden`
3. Type: **Integration**
4. Add, then download **Indoor Garden**
5. Restart Home Assistant
6. **Settings → Devices & Services → Add integration → Indoor Garden**

### Manual

Copy `custom_components/indoor_garden` to `/config/custom_components/indoor_garden`, then restart.

## First zone (existing grow lights)

1. Add the Indoor Garden integration
2. Zone name: `Grow Lights`
3. Grow lights: `Grow Lights Socket 1` (`switch.grow_lights_socket_1`)
4. Open the **Indoor Garden** item in the sidebar
5. Set mode **Auto**, start **06:00**, end **22:00** (or whatever you use)

Then turn **off** the old `Grow Lights - Apply Mode` automation so the two systems do not fight. The old helpers (`input_select.grow_lights_mode`, start/end datetimes, switch group) can stay until you are happy, then you can hide or delete them.

## Manage a zone

On the **Indoor Garden** panel, use **Edit zone** (or **Change** next to the light list). You can rename the zone, pick different lights or sockets, or delete the zone. Deleting a zone does not remove the physical devices.

You can also open **Settings → Devices & Services → Indoor Garden → Configure** on that zone.

## Another timing setup

**Add entry** on the Indoor Garden integration (or **Add zone** in the panel). Give it a different name, pick different lights, set a different Start/End.

## Lovelace

```yaml
type: custom:indoor-garden-card
```

The card is registered automatically when the integration loads.
