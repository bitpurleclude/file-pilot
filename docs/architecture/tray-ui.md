# Tray-first UI architecture

## Window model

```
Tray icon (right-click menu: Open / Settings / Open workspace / Quit)
  └─ left click toggles
       Popover window 396px wide, frameless, transparent, skipTaskbar
         ├─ drop / pick files
         ├─ analyze → plan card → dry-run / apply / rollback
         ├─ follow-up / correction
         └─ gear → Settings window (1060×760, native frame)
                        └─ close → popover re-shows and refetches settings
```

- The popover is created **hidden at startup** and is the only renderer until the user opens settings. This keeps the app tray-resident and gives Playwright a stable first window.
- `app.on("window-all-closed")` is intentionally a no-op; the tray owns app lifetime. `before-quit` disposes the tray/windows and closes SQLite.
- A single-instance lock makes a second launch show the existing popover.
- On first run (empty whitelist and not read-only) the popover shows automatically with the whitelist wizard; otherwise only the tray icon is visible.

## Main process

`apps/desktop/electron/main/window-manager.ts` owns:

- popover creation, tray creation, positioning above/below the tray, show/hide/toggle with a 250ms tray-click reopen guard. The popover does NOT auto-hide on blur (so dragging files in or switching windows never dismisses it); dismissal is explicit: Esc, the card close button, tray-icon toggle, or opening settings;
- native window shadow is off for the popover (`hasShadow: false`): a transparent frameless window's native shadow follows the rectangular window bounds and would stack a hard boxy shadow under the rounded card. The shadow is drawn by `.popover-card` CSS inside a 16px transparent window gutter.
- settings window creation/focus/close; closing settings re-shows the popover;
- `openWorkspace` (`shell.openPath`) and `pickFiles` (`dialog.showOpenDialog`);
- `resizePopover(height)` for content-driven height (clamped by IPC schema).

`real-main.ts` wires the manager into IPC channels and the updater. The popover sends `fp:popover-shown` when it becomes visible; the renderer refetches settings so read-only/language/whitelist changes made in the settings window are reflected without a restart.

### Settings close handshake

Closing the settings window (native X or `settings-back`) is intercepted by the main process. It sends `fp:settings-close-requested` to the renderer, which flushes the autosave controller and replies with `fp:confirm-settings-close`; only then does the window close. A 1.5s fallback closes an unresponsive renderer so the window can never become unclosable.

## Packaging icons

`build.win.icon` / `nsis.installerIcon` point at `resources/icon.ico`. electron-builder's own resource editing is left disabled (`signAndEditExecutable: false`) because its rcedit path requires extracting winCodeSign with symlink privileges. `scripts/after-pack.cjs` instead runs the standalone `rcedit` devDependency on the packed executable to set the icon and Windows version metadata before NSIS/portable targets are built.

## Renderer

`main.tsx` branches on `?view=`:

- `view=popover` → `pages/app.tsx` (composition of `pages/popover/*`)
- `view=settings` → `pages/settings/settings-app.tsx` → `settings-page.tsx`

The popover measures an inner `.popover-content` wrapper (not the flex body) and calls `fp:resize-popover`; this keeps the window compact for an empty dropzone and grows for a plan/wizard.

Settings keeps the existing autosave controller (600ms debounce) and tabs, now rendered as a sidebar. Whitelist edits are routed through `saveWhitelist` because the strict `saveSettings` contract does not accept that field.

## Test mode

`FILE_PILOT_E2E_HIDE_WINDOW=1` (default in the e2e helper):

- both windows are created with `show:false`/`skipTaskbar`, background throttling disabled;
- tray creation is skipped to avoid CI/headless tray dependencies;
- Playwright still drives both pages through CDP, and `openSettingsWindow`/`closeSettingsWindow` helpers manage the second page.

## Assets

- `resources/icon.ico` / `resources/icon.png`: installer + window icon (`build.win.icon`).
- `apps/desktop/electron/assets/tray-icon.png`: 32px tray image, copied to `dist/electron/assets` by `scripts/copy-sqlite-migrations.mjs`.
- `apps/desktop/electron/assets/app-icon.png`: settings window icon.
- `scripts/generate-icons.ps1` regenerates all three from one drawing.
