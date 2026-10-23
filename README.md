# Dock Glass

**English** · [Español](README.es.md)

[![CI](https://github.com/atarico/dock-glass/actions/workflows/ci.yml/badge.svg)](https://github.com/atarico/dock-glass/actions/workflows/ci.yml)

A GNOME Shell extension that makes Ubuntu Dock or Dash to Dock feel like the macOS Dock: a glass pill, icons that magnify continuously and spread apart under the pointer, a launch bounce, windows that open with a genie effect from their dock icon, and a macOS-like stack of places that springs out of the Files icon.

> [!NOTE]
> **Early project.** Developed and tested on Ubuntu 24.04, GNOME Shell 46 on X11, with Ubuntu Dock at the bottom, 48px icons and the Yaru theme. Values are hardcoded for now; a preferences window is planned. It is not on [extensions.gnome.org](https://extensions.gnome.org) yet.

## See it in action

https://github.com/user-attachments/assets/bd634c8b-6130-4676-b36d-0bb86aa4d3ca

*Magnification and the glass pill, on top of Blur My Shell's Liquid Glass (zoomed-in recording).*

https://github.com/user-attachments/assets/d73059d8-f738-452c-ac48-0fbdbee42390

*The Files places stack: folders spring out of the icon, fly back into it when it closes, and open with a click.*

https://github.com/user-attachments/assets/dc25134f-0db5-4ce9-8d47-6a419962a23b

*Minimize and restore with the Magic Lamp companion extension. Dock Glass aims its genie at the icon's resting place in the dock.*

## Features

| Feature | What you see |
|---------|--------------|
| Magnification | Icons grow from their bottom edge as the pointer moves over the dock, 1.4x under it and back to rest size three icons away. Like on macOS, no icon ever shrinks: neighbors spread apart and the pill widens to fit them |
| Glass pill | A fully rounded dock with a light inner rim, made to sit on top of Blur My Shell's Liquid Glass |
| Launch bounce | An icon bounces until the app it launched shows its window |
| Genie on open | New app windows pour out of their dock icon, from where it is drawn even while magnified, instead of GNOME's default open animation. macOS keeps the genie for minimize and restore; this one is a Dock Glass addition |
| Files places stack | With no Files windows open, a click on the Files icon fans out your places (home, Desktop, Documents, Downloads, Pictures and bookmarks). Items spring out of the icon and fly back into it when the stack closes. With Files windows open, the click works as usual |
| Files next to the Trash | When Files is your last pinned app, the separator moves to its left, so Files sits with the Trash like the folders of the macOS Dock |
| Running dot | One small dot under each open app |

For the genie on minimize and restore too, add [Magic Lamp](https://github.com/hermes83/compiz-alike-magic-lamp-effect) (see Recommended setup).

## Install

1. Clone the repository into your extensions folder. The folder name must be the extension's UUID:
   ```sh
   git clone https://github.com/atarico/dock-glass.git \
     ~/.local/share/gnome-shell/extensions/dock-glass@atarico.github.io
   ```
2. Restart GNOME Shell. On X11 press `Alt+F2`, type `r` and press Enter. On Wayland, log out and back in.
3. Enable it:
   ```sh
   gnome-extensions enable dock-glass@atarico.github.io
   ```
4. Move the pointer over the dock: the icon under it grows above the pill and its neighbors spread apart.

To update, run `git pull` in that folder and restart GNOME Shell. To uninstall, run `gnome-extensions disable dock-glass@atarico.github.io` and delete the folder.

**Translations.** A clone has no compiled translations, so the stack's labels show in English. For your language (Spanish for now), run `sh scripts/build-locale.sh` in that folder, which needs gettext (`sudo apt install gettext` on Ubuntu), and restart GNOME Shell. Run it again after each `git pull`.

**Installed as `dock-glass@local`?** Earlier versions used that UUID, and GNOME Shell only loads an extension from a folder named after its UUID. Rename the folder to `dock-glass@atarico.github.io`, restart GNOME Shell and enable it again with the command above.

## Recommended setup

Dock Glass styles and animates the dock; the full look also depends on a few settings outside the extension.

**The dock.** A transparent background (the glass comes from Blur My Shell), a click that focuses or minimizes, and a single running dot:

```sh
gsettings set org.gnome.shell.extensions.dash-to-dock transparency-mode 'FIXED'
gsettings set org.gnome.shell.extensions.dash-to-dock background-opacity 0.0
gsettings set org.gnome.shell.extensions.dash-to-dock click-action 'focus-minimize-or-previews'
gsettings set org.gnome.shell.extensions.dash-to-dock running-indicator-style 'DEFAULT'
```

With Dash to Dock from extensions.gnome.org, set the same four options in its preferences window instead.

**Files.** Pin Files as your last app so it groups with the Trash.

**Blur My Shell** ([extension](https://github.com/aunetx/blur-my-shell)). In its preferences, for the dock:

| Setting | Value |
|---------|-------|
| Static blur | Off, so the glass blurs what is actually behind the dock |
| Pipeline | One "Liquid Glass" effect: blur radius 10, edge size 16, tint 0, shadow 0.1, specular strength 0.6 |

**Optional companions.** [Magic Lamp](https://github.com/hermes83/compiz-alike-magic-lamp-effect) for the genie on minimize and restore. [Burn My Windows](https://github.com/Schneegans/Burn-My-Windows) for close effects; Dock Glass leaves window closing to it. Turn its open effects off, so new windows only get the genie.

## Compatibility

| Component | Status |
|-----------|--------|
| GNOME Shell 46 to 51 | Supported; each version checked live (see below) |
| GNOME Shell 52 and later | Not tested yet; `metadata.json` declares 46 to 51 |
| Ubuntu Dock (`ubuntu-dock@ubuntu.com`) | Supported; one of the two docks is required |
| Dash to Dock (`dash-to-dock@micxgx.gmail.com`) | Supported; while enabled it replaces Ubuntu Dock, and Dock Glass follows it |
| Dock position | Bottom only; side docks are left unchanged |
| X11 | Tested |
| Wayland | Not tested |

### Other GNOME versions and distros

Other distros use Dash to Dock, from their packages or from extensions.gnome.org. A GNOME version goes into `shell-version` in `metadata.json` only after a live check on it. Each listed version was checked on a headless GNOME Shell with a virtual pointer and screenshots, using the dock its distro ships:

| GNOME Shell | Distro | Dock |
|-------------|--------|------|
| 46 | Ubuntu 24.04 | Ubuntu Dock |
| 47 | Ubuntu 24.10 | Ubuntu Dock |
| 48 | Debian 13 | Dash to Dock |
| 49 | Fedora 43 | Dash to Dock |
| 50 | Ubuntu 26.04 | Ubuntu Dock |
| 51 | Ubuntu 26.10 | Ubuntu Dock |

Each check covered the magnification, the places stack (fan and grid), launching an app from the dock, the genie on open, and disabling and enabling Dock Glass, with no Dock Glass errors in the log. Two GNOME changes touch Dock Glass, and `shellCompat.js` handles both: GNOME 50 removed `Clutter.Grab.get_seat_state()`, and GNOME 51 removed `St.BoxLayout`'s `vertical` in favor of `orientation`, which GNOME 48 added.

To check a version by hand, use a virtual machine (GNOME Boxes, for example) with a distro that ships it, such as those above.

1. In the virtual machine, if the distro has no Ubuntu Dock, install Dash to Dock from extensions.gnome.org.
2. On your machine, add the version to `shell-version`, run `sh scripts/pack.sh` and copy the zip from `dist/` into the virtual machine.
3. There, run `gnome-extensions install --force dock-glass@atarico.github.io.shell-extension.zip`, log out and back in, and run `gnome-extensions enable dock-glass@atarico.github.io`.
4. Use the dock while `journalctl -f -o cat /usr/bin/gnome-shell` runs in a terminal, and look for errors.

## Known limitations

- **Hardcoded values.** The magnification peak, its reach and the glass are fixed until the preferences window exists.
- **Translations.** The places stack's labels are translated to Spanish only; other languages show them in English. Folder names come from your system.
- **Separator grouping.** Unpinned running apps still appear between Files and the Trash.
- **Keyboard activation.** Opening Files from the keyboard (Enter on a focused icon, or `Super`+number) with no Files windows also opens the places stack.
- **Dock internals.** The extension hooks private parts of the dock, which Ubuntu Dock and Dash to Dock share, so a dock update can break it. They are all reached through `dockAdapter.js`, the one file to adapt when that happens.
- **Switching docks.** After enabling or disabling Ubuntu Dock or Dash to Dock, restart GNOME Shell (on X11, `Alt`+`F2` then `r`; on Wayland, log out and back in). Ubuntu Dock does not recover from a switch while the shell runs, and Dock Glass picks up the new dock only after the restart.

<details>
<summary><strong>How it works</strong></summary>

- **Headroom.** Ubuntu Dock clips its content. The stylesheet raises the icon tiles' top padding and adds the same top margin to the pill background, so the pill keeps its size and the largest icon can rise above it. Sideways, the extension turns off the scroll view's clip and widens the slide container's clip, which Ubuntu Dock resets on every allocation, so spread icons and the wider glass stay visible.
- **Magnification.** A per-dock `Clutter.Timeline` reads the pointer every frame while it is over the pill. `magnifier.js` turns each icon's distance from the smoothed pointer into a scale (a cosine falloff) and the extra width of the icons in between into a sideways shift. The extension applies them as transforms only: the scale on each icon, the shift on its button (so the running dot follows) and on the separator, and a horizontal scale and shift on the pill background, which Blur My Shell's glass follows. The dock's allocations never change, so its input region, intellihide and minimize targets keep their rest geometry. The loop stops once the icons settle, restarts on pointer motion, and fades out to exactly the rest layout when the pointer leaves.
- **Events.** Pointer events come from `dashtodockBox`, the dock's reactive, hover-tracked box. Clutter does not route events through the non-reactive dock container.
- **Stacks.** Files gets an instance `activate` override that opens the places stack only on a plain left click with no Files windows. The stack is a full-stage transparent actor under `Main.pushModal`, and an outside click, a click on the icon or Escape closes it. The dock stays visible through Ubuntu Dock's item menu state while it is open. Opacity eases separately from the springy motion, because Clutter stores it in 8 bits and an overshooting easing mode would wrap it.
- **Genie on open.** A wrapper around `Main.wm._shouldAnimateActor` skips GNOME's map animation for normal app windows, and a `map` handler adds the genie deform effect instead. It starts from the app's dock icon as drawn at that moment, on the window's monitor when the app has a dock icon there. The wrapper restores itself only while it is still outermost, so it chains safely with Burn My Windows and Magic Lamp.
- **Separator.** Ubuntu Dock re-inserts the separator after the pinned apps on every redisplay. When the icon before it is Files, the extension moves it one slot left before the next frame. The separator is not an app item, so the dock's app list and drag and drop are unaffected. Disabling the extension undoes the move.

</details>

## Development

| File | Role |
|------|------|
| `extension.js` | Hooks into the dock: magnifier, clips, separator, Files stack, launch bounce |
| `dockAdapter.js` | The only access to the private internals of Ubuntu Dock and Dash to Dock: loading the module of every installed dock, finding the one that runs, its dock manager and each dock's actors |
| `openAnimation.js` | Replaces the window open animation with the genie |
| `genieEffect.js` | The genie deform effect |
| `magnifier.js` | Pure magnification math |
| `stack.js` | The stack popup: actors, animations, input |
| `stackLayout.js` | Pure stack layout math |
| `shellCompat.js` | The differences between GNOME Shell 46 and 51 that Dock Glass handles, as pure functions |
| `stylesheet.css` | Pill, headroom, running dot and stack styles |
| `po/` | Translations, one `<language>.po` per language |
| `scripts/build-locale.sh` | Compiles `po/` into `locale/`, where GNOME Shell reads them |
| `scripts/pack.sh` | Builds the installable zip, translations included |
| `.github/workflows/ci.yml` | Tests, syntax check and packing on GitHub Actions, plus releases on `v*` tags |

The pure math and the dock adapter have no GNOME imports, so Node.js 22 or newer can test them from the repository root:

```sh
node --test
```

The same run also checks that the relative imports of the modules at the repository root only point to each other, that `metadata.json` is complete and that every `po/` file translates exactly the strings the code passes to `_()`. To build the archive that `gnome-extensions install` takes, in `dist/` (needs gettext):

```sh
sh scripts/pack.sh
```

GitHub Actions runs the tests, a syntax check of every module and the packing on every pull request and push to `main`. Pushing a `v*` tag also publishes a GitHub release with the packed zip.

The GNOME Shell side has no automated tests. For development, symlink your clone instead of cloning into the extensions folder:

```sh
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/dock-glass@atarico.github.io
```

Restart GNOME Shell after each change, and watch for errors with:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

## License

[GPL-3.0-or-later](LICENSE). Copyright (C) 2026 atarico.

`genieEffect.js` is adapted from the unminimize effect of [Compiz alike magic lamp effect](https://github.com/hermes83/compiz-alike-magic-lamp-effect) by hermes83 (GPL-3.0-or-later).
