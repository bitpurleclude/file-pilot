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
      void this.persist(settings);
    }, this.options.debounceMs);
  }

  public retry(): void {
    if (this.latestSettings === null) {
      return;
    }
    this.schedule(this.latestSettings, "immediate");
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
    void this.persist(settings);
  }

  private async persist(settings: AppSettings): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.isSaving = true;
    this.options.onStateChange({ status: "saving" });

    try {
      await this.options.save(settings);
      if (!this.disposed) {
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
      if (this.queued !== null) {
        const next = this.queued;
        this.queued = null;
        this.schedule(next.settings, next.mode);
      }
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
