# Dock Glass

A GNOME Shell extension that turns Ubuntu Dock into a macOS-like dock: a glass pill, icons that magnify continuously and spread apart as the pointer moves over them, and a launch bounce.

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

The magnifier math lives in `magnifier.js` and the stack layout math in `stackLayout.js`. Neither has GNOME imports, so Node.js 22 or newer can test them:

```sh
node --test
```

The GNOME Shell integration has no automated tests; check it by hand after restarting the shell.

## Features

| Feature | What it does | Where |
|---------|--------------|-------|
| Pill shape | Fully rounded dock with a light inner rim | `stylesheet.css` |
| Continuous magnification | Like the macOS Dock: icons grow from their bottom edge by their distance from the pointer, 1.4x under it and back to rest size three icon slots away along a cosine curve. They never shrink, neighbors spread apart instead of overlapping, and the pill widens with them | `magnifier.js`, `extension.js` |
| Launch bounce | A dock icon bounces until the launched app shows its window, starting from its current magnified size | `extension.js` |
| Files places stack | While Files has no windows, a click on its icon springs a macOS-like stack of places out of it (home, Desktop, Documents, Downloads, Pictures and GTK bookmarks): a fan for up to ten items, a grid panel beyond that, with an entry to open Files on top. With windows open the click keeps Ubuntu Dock's behavior | `stack.js`, `stackLayout.js`, `extension.js` |
| Files next to the Trash | When Files is the last pinned app, the separator moves to its left, so Files sits with the Trash on the right side like the folders of the macOS Dock. Unpinned running apps still appear between Files and the Trash | `extension.js` |

Like on macOS, new windows use the system open animation; the genie belongs to minimize and restore, which Magic Lamp provides.

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
| Dash to Dock `click-action` | `focus-minimize-or-previews` (a deliberate departure from macOS: a click on the focused app minimizes it) |
| Dash to Dock `running-indicator-style` | `DEFAULT` (one small dot per open app) |
| Blur My Shell dock `static-blur` | `false` (live blur of what is behind the dock) |
| Blur My Shell dock pipeline | One "Liquid Glass" (`refraction`) effect: `blur_radius` 10, `edge_size` 16, `tint` 0, `shadow` 0.1, `specular_strength` 0.6 |

## How it works

- **Headroom.** Ubuntu Dock clips its content vertically. The stylesheet raises the icon tiles' top padding and adds the same top margin to the pill background. The pill keeps its size, and the largest icon has room to rise above it. Sideways, the extension turns off the scroll view's clip and widens the slide container's clip, which Ubuntu Dock resets to the pill's rest width on every allocation, so spread icons and the wider glass stay visible.
- **Magnification.** A per-dock `Clutter.Timeline` reads the pointer in stage coordinates every frame while it is over the pill. `magnifier.js` turns each icon's distance from the smoothed pointer into a scale, and the extra width of the icons between them into a sideways shift. The extension applies them as transforms: the scale on each icon, the shift on its button (so the running dot follows) and on the separator, and a horizontal scale and shift on the pill background, which Blur My Shell's glass follows. Icons that are not allocated yet, as while the dock fills up at startup, are left alone. Pointer events are taken from `dashtodockBox`, the dock's reactive, hover-tracked box, because Clutter does not route events through the non-reactive dock container. No allocation changes, so the dock's input region and intellihide keep their rest geometry. Ubuntu Dock measures minimize targets from the button's transformed position, so the extension wraps that measurement to leave the spread shift out, and Magic Lamp's genie aims at the icon's rest slot. The loop stops once the icons settle, restarts on pointer motion, and after the pointer leaves it fades out to exactly the rest layout.
- **Stacks.** Files gets an instance `activate` override that opens the places stack only on a plain left click with no Files windows. A stack is a full-stage transparent actor under `Main.pushModal`: a click outside it, a click on the dock icon again, or Escape closes it, and the dock is held visible through Ubuntu Dock's item menu state while it is open. Opening springs the items out nearest first and fades each label in once its icon lands; closing fades the labels first and flies the items back into the icon farthest first. The stack labels are Spanish for now (`Abrir Archivos`, `Carpeta personal`), until the extension gets translations.
- **Separator.** Ubuntu Dock re-inserts the separator after the pinned apps on every redisplay. When the icon before it is Files, the extension moves it one slot left in a `BEFORE_REDRAW` later, so it never visibly jumps. The separator is not an app item, so the dock's app diff and drag and drop are unaffected. On disable the move is undone.

## License

GPL-3.0-or-later, see [LICENSE](LICENSE).
