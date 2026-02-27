import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppSettings } from "../../shared/types/settings.js";
import { SettingsAutosaveController, type SettingsAutosaveState } from "../../src/pages/settings/settings-autosave-controller.js";

const createSettings = (language: "en" | "zh-CN" = "en"): AppSettings => ({
  language,
  whitelistDirectories: [],
  readOnlyMode: false,
  classification: {
    highConfidenceMin: 0.85,
    mediumConfidenceMin: 0.6,
    askThreshold: 0.6
  },
  ruleLearning: {
    enabled: true,
    autoApplyThreshold: 0.9
  },
  llmProviders: {
    activeProviderId: "provider-1",
    providers: [
      {
        id: "provider-1",
        presetId: "openai",
        name: "OpenAI",
        isPreset: true,
        baseUrl: "https://api.openai.com/v1",
        authType: "bearer",
        protocol: "openai",
        apiKey: "test",
        primaryModel: "gpt-4.1",
        secondaryModel: "gpt-4.1-mini",
        modelControlMode: "manual",
        intensity: "balanced",
        intensityProfiles: {
          speed: { primaryModel: "gpt-4.1-mini", secondaryModel: "gpt-4.1-mini" },
          balanced: { primaryModel: "gpt-4.1", secondaryModel: "gpt-4.1-mini" },
          quality: { primaryModel: "gpt-4.1", secondaryModel: "gpt-4.1" }
        },
        enabled: true
      }
    ]
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("settings-autosave-controller", () => {
  it("debounces text changes and saves once with latest payload", async () => {
    vi.useFakeTimers();

    const saveMock = vi.fn(async () => undefined);
    const states: SettingsAutosaveState[] = [];
    const controller = new SettingsAutosaveController({
      debounceMs: 600,
      save: saveMock,
      onStateChange: (state) => {
        states.push(state);
      }
    });

    controller.schedule(createSettings("en"), "debounced");
    controller.schedule(createSettings("zh-CN"), "debounced");

    await vi.advanceTimersByTimeAsync(599);
    expect(saveMock).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ language: "zh-CN" }));
    expect(states.some((state) => state.status === "saving")).toBe(true);
    expect(states.some((state) => state.status === "saved")).toBe(true);

    controller.dispose();
  });

  it("saves immediately for non-text updates", async () => {
    const saveMock = vi.fn(async () => undefined);
    const controller = new SettingsAutosaveController({
      debounceMs: 600,
      save: saveMock,
      onStateChange: () => undefined
    });

    controller.schedule(createSettings("en"), "immediate");
    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    controller.dispose();
  });

  it("keeps error state and allows retry", async () => {
    const saveMock = vi.fn(async (_settings: AppSettings) => undefined);
    saveMock.mockRejectedValueOnce(new Error("network failed"));
    saveMock.mockResolvedValueOnce(undefined);

    const states: SettingsAutosaveState[] = [];
    const controller = new SettingsAutosaveController({
      debounceMs: 600,
      save: async (settings) => {
        await saveMock(settings);
      },
      onStateChange: (state) => {
        states.push(state);
      }
    });

    controller.schedule(createSettings("en"), "immediate");
    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(() => {
      const lastError = states.at(-1);
      expect(lastError?.status).toBe("error");
    });
    expect(states.at(-1)?.errorMessage).toContain("network failed");

    controller.retry();
    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(2);
    });

    await vi.waitFor(() => {
      const finalState = states.at(-1);
      expect(finalState?.status).toBe("saved");
    });

    controller.dispose();
  });
});
