import type { AppSettings } from "../../../shared/types/settings.js";

export type SettingsUpdateMode = "debounced" | "immediate";

export type SettingsDraftChange = (settings: AppSettings, mode?: SettingsUpdateMode) => void;
