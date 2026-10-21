# Dock Glass

A GNOME Shell extension that turns Ubuntu Dock into a macOS-like dock: a glass pill, icons that magnify continuously as the pointer moves over them, a launch bounce, and windows that open with a genie effect from their dock icon.

> **Status: early personal project.** Tested only on Ubuntu 24.04, GNOME Shell 46, X11, with Ubuntu Dock at the bottom, 48px icons and the Yaru theme. Values are hardcoded for now; a preferences window is planned.

## Quick path (development install)

1. From the repository root, link it as an installed extension:
   ```sh
   ln -s "$PWD" ~/.local/share/gnome-shell/extensions/dock-glass@local
   gnome-extensions enable dock-glass@local
   ```
2. Restart GNOME Shell: on X11 press `Alt+F2`, type `r`, press Enter. On Wayland, log out and back in.
3. Hover over the dock: the icon under the pointer grows above the pill, its neighbors grow less and spread apart, and the pill widens to fit them.

After editing any file, restart GNOME Shell again to load the change.

## Tests

The magnifier math lives in `magnifier.js`, which has no GNOME imports, so Node.js 22 or newer can test it:

```sh
node --test
```

The GNOME Shell integration has no automated tests; check it by hand after restarting the shell.

## Features

| Feature | What it does | Where |
|---------|--------------|-------|
| Pill shape | Fully rounded dock; the glass's specular edge is the rim | `stylesheet.css` |
| Continuous magnification | Like the macOS Dock: icons grow from their bottom edge by their distance from the pointer, 1.4x under it and back to rest size three tiles away along a cosine curve. They never shrink, neighbors spread apart instead of overlapping, and the pill widens with them | `magnifier.js`, `extension.js` |
| Launch bounce | A dock icon bounces until the launched app shows its window, starting from its current magnified size | `extension.js` |
| Genie open effect | New app windows pour out of their dock icon instead of GNOME's default open animation | `openAnimation.js`, `genieEffect.js` |

## Requirements

| Component | Needed for |
|-----------|-----------|
| GNOME Shell 46 | Everything |
| Ubuntu Dock (`ubuntu-dock@ubuntu.com`) | Everything; Dash to Dock is not supported yet |
| [Blur My Shell](https://github.com/aunetx/blur-my-shell) (optional) | The glass background behind the pill |
| [Compiz alike Magic Lamp](https://github.com/hermes83/compiz-alike-magic-lamp-effect) (optional) | The matching genie on minimize and restore |
| [Burn My Windows](https://github.com/Schneegans/Burn-My-Windows) (optional) | Close effects; Dock Glass leaves window closing to it |

## Companion settings

The full look also depends on settings outside the extension. They are meant to move into the planned preferences window.

| Setting | Value |
|---------|-------|
| Dash to Dock `transparency-mode` | `FIXED` |
| Dash to Dock `background-opacity` | `0.0` |
| Dash to Dock `click-action` | `focus-minimize-or-previews` |
| Blur My Shell dock `static-blur` | `false` (live blur of what is behind the dock) |
| Blur My Shell dock pipeline | One "Liquid Glass" (`refraction`) effect: `blur_radius` 10, `edge_size` 16, `tint` 0, `shadow` 0.1, `specular_strength` 0.6 |

## How it works

- **Headroom.** Ubuntu Dock clips its content vertically. The stylesheet raises the icon tiles' top padding and adds the same top margin to the pill background. The pill keeps its size, and the largest icon has room to rise above it. Sideways, the extension turns off the scroll view's clip so spread icons stay visible.
- **Magnification.** A per-dock `Clutter.Timeline` reads the pointer in stage coordinates every frame while it is over the pill. `magnifier.js` turns each icon's distance from the smoothed pointer into a scale, and the extra width of the icons between them into a sideways shift. The extension applies them as transforms: the scale on each icon, the shift on its button (so the running dot follows), and a horizontal scale and shift on the pill background, which Blur My Shell's glass follows. No allocation changes, so the dock's input region, intellihide and minimize targets keep their rest geometry. The loop stops once the icons settle, restarts on pointer motion, and after the pointer leaves it fades out to exactly the rest layout.
- **Genie on open.** A wrapper around `Main.wm._shouldAnimateActor` skips GNOME's map animation for normal app windows. A `map` handler then adds the genie deform effect. The wrapper restores itself only while it is still outermost, so it chains safely with Burn My Windows and Magic Lamp.

## License

GPL-3.0-or-later, see [LICENSE](LICENSE).

`genieEffect.js` is adapted from the unminimize effect of [Compiz alike magic lamp effect](https://github.com/hermes83/compiz-alike-magic-lamp-effect) by hermes83 (GPL-3.0-or-later).
