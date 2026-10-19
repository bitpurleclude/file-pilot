import type { AppSettings } from "../../../shared/types/settings.js";
import type { SettingsUpdateMode } from "./settings-change.js";

export type SettingsSaveStatus = "idle" | "saving" | "saved" | "error";

export interface SettingsAutosaveState {
  status: SettingsSaveStatus;
  errorMessage?: string;
}

interface SettingsAutosaveControllerOptions {
  debounceMs: number;
  save: (settings: AppSettings) => Promise<void>;
  onStateChange: (state: SettingsAutosaveState) => void;
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

export class SettingsAutosaveController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isSaving = false;
  private queued: { settings: AppSettings; mode: SettingsUpdateMode } | null = null;
  private disposed = false;
  private latestSettings: AppSettings | null = null;
  private lastPersisted: AppSettings | null = null;
  private inFlight: Promise<void> | null = null;

  public constructor(private readonly options: SettingsAutosaveControllerOptions) {
    this.options.onStateChange({ status: "idle" });
  }

  public schedule(settings: AppSettings, mode: SettingsUpdateMode = "debounced"): void {
    this.latestSettings = settings;
    if (mode === "immediate") {
      this.scheduleImmediate(settings);
      return;
    }

    if (this.isSaving) {
      this.queued = { settings, mode: "debounced" };
      return;
    }

    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.startPersist(settings);
    }, this.options.debounceMs);
  }

  public retry(): void {
    if (this.latestSettings === null) {
      return;
    }
    this.schedule(this.latestSettings, "immediate");
  }

  /**
   * Cancels a pending debounce and waits for all in-flight/queued saves.
   * Used when the settings window is closing so the last edit is not lost.
   */
  public async flush(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.clearTimer();

    while (this.inFlight !== null) {
      await this.inFlight;
    }

    if (this.latestSettings !== null && this.latestSettings !== this.lastPersisted) {
      await this.startPersist(this.latestSettings);
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private scheduleImmediate(settings: AppSettings): void {
    if (this.isSaving) {
      this.queued = { settings, mode: "immediate" };
      return;
    }
    this.clearTimer();
    void this.startPersist(settings);
  }

  private startPersist(settings: AppSettings): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    this.isSaving = true;
    this.options.onStateChange({ status: "saving" });

    const task = (async (): Promise<void> => {
      try {
        await this.options.save(settings);
        if (!this.disposed) {
          this.lastPersisted = settings;
          this.options.onStateChange({ status: "saved" });
        }
      } catch (error) {
        if (!this.disposed) {
          this.options.onStateChange({
            status: "error",
            errorMessage: toErrorMessage(error)
          });
        }
      } finally {
        this.isSaving = false;
        this.inFlight = null;
        if (this.queued !== null) {
          const next = this.queued;
          this.queued = null;
          this.schedule(next.settings, next.mode);
        }
      }
    })();

    this.inFlight = task;
    return task;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
