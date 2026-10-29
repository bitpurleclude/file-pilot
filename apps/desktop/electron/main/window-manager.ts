import { app, BrowserWindow, dialog, Menu, nativeImage, screen, shell, Tray } from "electron";
import { join } from "node:path";

import { IPC_CHANNELS } from "../../shared/ipc/contracts.js";

const POPOVER_WIDTH = 428;
const POPOVER_HEIGHT = 672;
const SETTINGS_WIDTH = 1060;
const SETTINGS_HEIGHT = 760;
const REOPEN_GUARD_MS = 250;

export interface WindowManagerOptions {
  preloadPath: string;
  rendererHtmlPath: string;
  assetsDir: string;
  workspaceRoot: string;
  /** Hide every window (e2e). Playwright still drives the renderer via CDP. */
  hideWindows: boolean;
  /** Disable tray creation on CI/headless Windows runners. */
  enableTray: boolean;
}

export interface WindowManager {
  createPopover: (options?: { showOnReady?: boolean }) => BrowserWindow;
  createTray: () => void;
  showPopover: () => void;
  hidePopover: () => void;
  togglePopover: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  confirmSettingsClose: () => void;
  getPopover: () => BrowserWindow | null;
  openWorkspace: () => Promise<void>;
  pickFiles: () => Promise<string[]>;
  resizePopover: (height: number) => void;
  setQuitting: () => void;
  dispose: () => void;
}

const clamp = (value: number, min: number, max: number): number => (
  Math.min(Math.max(value, min), max)
);

/**
 * 渲染层只加载本地打包资源；允许 file:// 初始导航（loadFile 也走
 * will-navigate），拦截一切远程/其他协议导航与新窗口。
 */
const attachNavigationGuards = (win: BrowserWindow): void => {
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
};

export const createWindowManager = (options: WindowManagerOptions): WindowManager => {
  let popoverWindow: BrowserWindow | null = null;
  let settingsWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;
  let popoverReady = false;
  let pendingShow = false;
  let lastHideAt = 0;
  let settingsCloseApproved = false;
  let settingsCloseTimer: ReturnType<typeof setTimeout> | null = null;

  const clearSettingsCloseTimer = (): void => {
    if (settingsCloseTimer !== null) {
      clearTimeout(settingsCloseTimer);
      settingsCloseTimer = null;
    }
  };

  const emitPopoverShown = (): void => {
    if (popoverWindow !== null && !popoverWindow.isDestroyed()) {
      popoverWindow.webContents.send(IPC_CHANNELS.popoverShown);
    }
  };

  const positionPopover = (): void => {
    if (popoverWindow === null) {
      return;
    }

    const trayBounds = tray?.getBounds();
    const display = screen.getDisplayMatching(trayBounds ?? screen.getPrimaryDisplay().workArea);
    const area = display.workArea;
    const trayAtBottom = trayBounds === undefined
      ? true
      : trayBounds.y > area.y + area.height / 2;

    const x = trayBounds === undefined
      ? area.x + area.width - POPOVER_WIDTH - 12
      : Math.round(trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2);
    const y = trayBounds === undefined
      ? area.y + area.height - POPOVER_HEIGHT - 12
      : trayAtBottom
        ? trayBounds.y - POPOVER_HEIGHT - 10
        : trayBounds.y + trayBounds.height + 10;

    popoverWindow.setPosition(
      clamp(x, area.x + 8, area.x + area.width - POPOVER_WIDTH - 8),
      clamp(y, area.y + 8, area.y + area.height - POPOVER_HEIGHT - 8),
      false
    );
  };

  const showPopover = (): void => {
    if (popoverWindow === null || popoverWindow.isDestroyed()) {
      return;
    }
    if (!popoverReady) {
      pendingShow = true;
      return;
    }

    positionPopover();
    if (!options.hideWindows) {
      if (popoverWindow.isMinimized()) {
        popoverWindow.restore();
      }
      popoverWindow.show();
      popoverWindow.focus();
    }
    emitPopoverShown();
  };

  const hidePopover = (): void => {
    if (popoverWindow === null || popoverWindow.isDestroyed() || !popoverWindow.isVisible()) {
      return;
    }
    lastHideAt = Date.now();
    popoverWindow.hide();
  };

  const togglePopover = (): void => {
    if (popoverWindow === null) {
      return;
    }
    if (popoverWindow.isVisible()) {
      hidePopover();
      return;
    }
    if (Date.now() - lastHideAt < REOPEN_GUARD_MS) {
      return;
    }
    showPopover();
  };

  const createPopover = (createOptions: { showOnReady?: boolean } = {}): BrowserWindow => {
    if (popoverWindow !== null && !popoverWindow.isDestroyed()) {
      return popoverWindow;
    }

    popoverReady = false;
    pendingShow = createOptions.showOnReady ?? false;

    popoverWindow = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: POPOVER_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // 透明无边框窗口的原生阴影跟随矩形窗口边界（而非渲染出的圆角卡片），
      // 会叠出方形硬阴影；阴影由渲染层 .popover-card 的 box-shadow 绘制，
      // 窗口四周预留 16px 透明边距容纳它。
      hasShadow: false,
      webPreferences: {
        preload: options.preloadPath,
        backgroundThrottling: false,
        // 显式声明安全默认值，纵深防御未来的默认值变化。
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    });

    attachNavigationGuards(popoverWindow);
    popoverWindow.setMenuBarVisibility(false);
    void popoverWindow.loadFile(options.rendererHtmlPath, { query: { view: "popover" } });

    popoverWindow.webContents.on("did-finish-load", () => {
      popoverReady = true;
      if (pendingShow) {
        pendingShow = false;
        showPopover();
      }
    });

    // 悬浮窗不随失焦自动隐藏（否则从资源管理器拖文件、切窗口即消失）。
    // 显式关闭路径：Esc / 卡片关闭按钮 / 托盘图标切换 / 打开设置。
    popoverWindow.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        hidePopover();
      }
    });

    popoverWindow.on("closed", () => {
      popoverWindow = null;
      popoverReady = false;
    });

    return popoverWindow;
  };

  const openSettings = (): void => {
    hidePopover();

    if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
      if (!options.hideWindows) {
        settingsWindow.show();
        settingsWindow.focus();
      }
      return;
    }

    settingsWindow = new BrowserWindow({
      width: SETTINGS_WIDTH,
      height: SETTINGS_HEIGHT,
      minWidth: 900,
      minHeight: 640,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#0b0f14",
      title: "File-Pilot Settings",
      icon: join(options.assetsDir, "app-icon.png"),
      webPreferences: {
        preload: options.preloadPath,
        backgroundThrottling: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    });

    attachNavigationGuards(settingsWindow);
    settingsCloseApproved = false;
    clearSettingsCloseTimer();
    void settingsWindow.loadFile(options.rendererHtmlPath, { query: { view: "settings" } });

    // Give the renderer a chance to flush its 600ms autosave before closing.
    // A 1.5s fallback still closes the window if the renderer is unresponsive.
    settingsWindow.on("close", (event) => {
      if (quitting || settingsCloseApproved) {
        return;
      }
      event.preventDefault();
      settingsWindow?.webContents.send(IPC_CHANNELS.settingsCloseRequested);
      if (settingsCloseTimer === null) {
        settingsCloseTimer = setTimeout(() => {
          settingsCloseTimer = null;
          settingsCloseApproved = true;
          settingsWindow?.close();
        }, 1500);
      }
    });

    settingsWindow.once("ready-to-show", () => {
      if (options.hideWindows || settingsWindow === null) {
        return;
      }
      settingsWindow.show();
      settingsWindow.focus();
    });

    settingsWindow.on("closed", () => {
      clearSettingsCloseTimer();
      settingsCloseApproved = false;
      settingsWindow = null;
      if (!quitting) {
        showPopover();
      }
    });
  };

  const closeSettings = (): void => {
    if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
  };

  const confirmSettingsClose = (): void => {
    clearSettingsCloseTimer();
    settingsCloseApproved = true;
    if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
  };

  const openWorkspace = async (): Promise<void> => {
    await shell.openPath(options.workspaceRoot);
  };

  const pickFiles = async (): Promise<string[]> => {
    const windowOptions = {
      title: "Select files for File-Pilot",
      properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">
    };
    const result = popoverWindow === null
      ? await dialog.showOpenDialog(windowOptions)
      : await dialog.showOpenDialog(popoverWindow, windowOptions);
    return result.canceled ? [] : result.filePaths;
  };

  const resizePopover = (height: number): void => {
    if (popoverWindow === null || popoverWindow.isDestroyed()) {
      return;
    }
    const size = popoverWindow.getContentSize();
    const width = size[0] ?? POPOVER_WIDTH;
    const currentHeight = size[1] ?? POPOVER_HEIGHT;
    if (currentHeight === height) {
      return;
    }
    popoverWindow.setContentSize(width, height, false);
    if (!options.hideWindows) {
      positionPopover();
    }
  };

  const createTray = (): void => {
    if (!options.enableTray || tray !== null) {
      return;
    }

    const icon = nativeImage.createFromPath(join(options.assetsDir, "tray-icon.png"));
    tray = new Tray(icon);
    tray.setToolTip("File-Pilot");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open File-Pilot", click: showPopover },
      { label: "Settings", click: openSettings },
      { type: "separator" },
      { label: "Open workspace", click: () => { void openWorkspace(); } },
      { type: "separator" },
      { label: "Quit File-Pilot", click: () => { app.quit(); } }
    ]));
    tray.on("click", togglePopover);
  };

  return {
    createPopover,
    createTray,
    showPopover,
    hidePopover,
    togglePopover,
    openSettings,
    closeSettings,
    confirmSettingsClose,
    getPopover: () => popoverWindow,
    openWorkspace,
    pickFiles,
    resizePopover,
    setQuitting: () => {
      quitting = true;
    },
    dispose: () => {
      quitting = true;
      clearSettingsCloseTimer();
      tray?.destroy();
      tray = null;
      settingsWindow?.destroy();
      settingsWindow = null;
      popoverWindow?.destroy();
      popoverWindow = null;
    }
  };
};
