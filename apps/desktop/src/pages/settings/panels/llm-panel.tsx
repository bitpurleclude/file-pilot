import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  buildProviderFromPreset,
  getAllProviderPresets,
  getProviderSuggestedModels,
  normalizeProviderConfig,
  resolveProviderModels
} from "../../../../shared/config/llm-providers.js";
import {
  MASKED_API_KEY,
  type LlmProviderConfig,
  type ProviderIntensityLevel
} from "../../../../shared/types/llm-provider.js";
import type { AppSettings } from "../../../../shared/types/settings.js";
import { Button } from "../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../components/ui/card.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../components/ui/select.js";
import { Switch } from "../../../components/ui/switch.js";
import type { SettingsDraftChange, SettingsUpdateMode } from "../settings-change.js";

interface LlmPanelProps {
  settings: AppSettings;
  onChange: SettingsDraftChange;
}

const toNonEmptyProviders = (providers: LlmProviderConfig[]): [LlmProviderConfig, ...LlmProviderConfig[]] | null => {
  const firstProvider = providers[0];
  if (firstProvider === undefined) {
    return null;
  }
  return [firstProvider, ...providers.slice(1)];
};

export const LlmPanel = ({ settings, onChange }: LlmPanelProps): JSX.Element => {
  const { t } = useTranslation();
  const [addPresetValue, setAddPresetValue] = React.useState<string>("");
  const [testStatus, setTestStatus] = React.useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = React.useState<string>("");

  const providers = settings.llmProviders.providers;
  const activeProvider = providers.find((provider) => provider.id === settings.llmProviders.activeProviderId)
    ?? providers[0];

  const commitProviders = (
    nextProviders: LlmProviderConfig[],
    activeProviderId: string,
    mode: SettingsUpdateMode
  ): void => {
    const normalizedProviders = nextProviders.map((provider) => normalizeProviderConfig(provider));
    const nonEmptyProviders = toNonEmptyProviders(normalizedProviders);
    if (nonEmptyProviders === null) {
      return;
    }

    const hasActiveProvider = normalizedProviders.some((provider) => provider.id === activeProviderId);
    const normalizedActiveId = hasActiveProvider ? activeProviderId : nonEmptyProviders[0].id;

    onChange({
      ...settings,
      llmProviders: {
        activeProviderId: normalizedActiveId,
        providers: nonEmptyProviders
      }
    }, mode);
  };

  const updateActiveProvider = (
    updater: (provider: LlmProviderConfig) => LlmProviderConfig,
    mode: SettingsUpdateMode
  ): void => {
    const currentActiveProvider = activeProvider;
    if (currentActiveProvider === undefined) {
      return;
    }

    const nextProviders = providers.map((provider) => {
      if (provider.id !== currentActiveProvider.id) {
        return provider;
      }
      return updater(provider);
    });

    commitProviders(nextProviders, currentActiveProvider.id, mode);
  };

  const handleAddProviderFromPreset = (presetId: string): void => {
    const newProvider = buildProviderFromPreset({
      providerId: crypto.randomUUID(),
      presetId
    });
    commitProviders([...providers, newProvider], newProvider.id, "immediate");
  };

  const handleAddCustomProvider = (): void => {
    const newProvider = normalizeProviderConfig({
      id: crypto.randomUUID(),
      name: t("settings.llm.customProviderName"),
      isPreset: false,
      baseUrl: "https://api.openai.com/v1",
      authType: "bearer",
      protocol: "openai",
      apiKey: "",
      primaryModel: "gpt-4o",
      secondaryModel: "gpt-4o-mini",
      modelControlMode: "manual",
      intensity: "balanced",
      intensityProfiles: {
        speed: { primaryModel: "gpt-4o-mini", secondaryModel: "gpt-4o-mini" },
        balanced: { primaryModel: "gpt-4o", secondaryModel: "gpt-4o-mini" },
        quality: { primaryModel: "gpt-4.1", secondaryModel: "gpt-4o" }
      },
      enabled: true
    });
    commitProviders([...providers, newProvider], newProvider.id, "immediate");
  };

  const handleDeleteProvider = (providerId: string): void => {
    if (providers.length <= 1) {
      return;
    }

    const nextProviders = providers.filter((provider) => provider.id !== providerId);
    const nextActiveProviderId = providerId === settings.llmProviders.activeProviderId
      ? nextProviders[0]?.id
      : settings.llmProviders.activeProviderId;
    if (nextActiveProviderId === undefined) {
      return;
    }
    commitProviders(nextProviders, nextActiveProviderId, "immediate");
  };

  const updateModelPair = (
    key: "primaryModel" | "secondaryModel",
    value: string
  ): void => {
    updateActiveProvider((provider) => {
      if (provider.modelControlMode === "manual") {
        return {
          ...provider,
          [key]: value
        };
      }

      const profile = provider.intensityProfiles[provider.intensity];
      return {
        ...provider,
        intensityProfiles: {
          ...provider.intensityProfiles,
          [provider.intensity]: {
            ...profile,
            [key]: value
          }
        }
      };
    }, "debounced");
  };

  const resolveEditableModels = (provider: LlmProviderConfig): { primaryModel: string; secondaryModel: string } => {
    if (provider.modelControlMode === "manual") {
      return {
        primaryModel: provider.primaryModel,
        secondaryModel: provider.secondaryModel
      };
    }
    return provider.intensityProfiles[provider.intensity];
  };

  const handleTestConnection = async (): Promise<void> => {
    if (window.filePilotApi === undefined || activeProvider === undefined) {
      return;
    }

    setTestStatus("testing");
    setTestMessage("");

    const resolvedModels = resolveProviderModels(activeProvider);
    const result = await window.filePilotApi.testProviderConnection({
      providerId: activeProvider.id,
      baseUrl: activeProvider.baseUrl,
      model: resolvedModels.primaryModel,
      authType: activeProvider.authType,
      protocol: activeProvider.protocol,
      ...(activeProvider.apiKey === undefined ? {} : { apiKey: activeProvider.apiKey }),
      ...(activeProvider.endpoint === undefined ? {} : { endpoint: activeProvider.endpoint }),
      ...(activeProvider.customHeaders === undefined ? {} : { customHeaders: activeProvider.customHeaders })
    });

    if (result.ok) {
      setTestStatus("success");
      setTestMessage(t("settings.llm.testSuccess"));
      return;
    }

    setTestStatus("error");
    setTestMessage(t("settings.llm.testFailed", { message: result.error.message }));
  };

  if (activeProvider === undefined) {
    return <div className="text-sm text-muted-foreground">{t("settings.llm.noProvider")}</div>;
  }

  const editableModels = resolveEditableModels(activeProvider);
  const suggestedModels = getProviderSuggestedModels(activeProvider);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.llm.providerListTitle")}</CardTitle>
          <CardDescription>{t("settings.llm.providerListDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className={`rounded-md border p-3 ${provider.id === settings.llmProviders.activeProviderId ? "border-primary" : "border-border"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{provider.name}</p>
                  <p className="text-xs text-muted-foreground">{provider.baseUrl}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={provider.id === settings.llmProviders.activeProviderId ? "default" : "outline"}
                    size="sm"
                    onClick={() => commitProviders(providers, provider.id, "immediate")}
                  >
                    {provider.id === settings.llmProviders.activeProviderId ? t("settings.llm.active") : t("settings.llm.activate")}
                  </Button>
                  <Switch
                    checked={provider.enabled}
                    onCheckedChange={(checked) => {
                      const nextProviders = providers.map((item) => (
                        item.id === provider.id ? { ...item, enabled: checked } : item
                      ));
                      commitProviders(nextProviders, settings.llmProviders.activeProviderId, "immediate");
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={providers.length <= 1}
                    onClick={() => handleDeleteProvider(provider.id)}
                  >
                    {t("settings.llm.deleteProvider")}
                  </Button>
                </div>
              </div>
            </div>
          ))}

          <Select
            value={addPresetValue}
            onValueChange={(value) => {
              setAddPresetValue("");
              if (value === "custom") {
                handleAddCustomProvider();
                return;
              }
              handleAddProviderFromPreset(value);
            }}
          >
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder={t("settings.llm.addProvider")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">{t("settings.llm.customProvider")}</SelectItem>
              {getAllProviderPresets().map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.llm.connectionTitle")}</CardTitle>
          <CardDescription>{t("settings.llm.connectionDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="provider-name">{t("settings.llm.providerName")}</Label>
            <Input
              id="provider-name"
              value={activeProvider.name}
              onChange={(event) => {
                updateActiveProvider((provider) => ({ ...provider, name: event.target.value }), "debounced");
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="llm-base-url">{t("settings.llm.baseUrl")}</Label>
            <Input
              id="llm-base-url"
              value={activeProvider.baseUrl}
              onChange={(event) => {
                updateActiveProvider((provider) => ({ ...provider, baseUrl: event.target.value }), "debounced");
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="llm-api-key">{t("settings.llm.apiKey")}</Label>
            <Input
              id="llm-api-key"
              type="password"
              value={activeProvider.apiKey === MASKED_API_KEY ? "" : (activeProvider.apiKey ?? "")}
              placeholder={activeProvider.apiKey === MASKED_API_KEY
                ? t("settings.llm.apiKeyStored")
                : t("settings.llm.apiKeyPlaceholder")}
              onChange={(event) => {
                const value = event.target.value;
                updateActiveProvider((provider) => {
                  if (value.length > 0) {
                    return { ...provider, apiKey: value };
                  }
                  // 清空输入 = 保留已存储的 key（哨兵原样回传）；
                  // 原本没有 key 的 provider 则清除占位空串。
                  return provider.apiKey === MASKED_API_KEY ? provider : { ...provider, apiKey: "" };
                }, "debounced");
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("settings.llm.protocol")}</Label>
              <Select
                value={activeProvider.protocol}
                onValueChange={(value) => {
                  updateActiveProvider((provider) => ({
                    ...provider,
                    protocol: value as LlmProviderConfig["protocol"]
                  }), "immediate");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>{t("settings.llm.authType")}</Label>
              <Select
                value={activeProvider.authType}
                onValueChange={(value) => {
                  updateActiveProvider((provider) => ({
                    ...provider,
                    authType: value as LlmProviderConfig["authType"]
                  }), "immediate");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bearer">Bearer</SelectItem>
                  <SelectItem value="api-key">API Key</SelectItem>
                  <SelectItem value="none">{t("settings.llm.noAuth")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="llm-endpoint">{t("settings.llm.endpoint")}</Label>
            <Input
              id="llm-endpoint"
              value={activeProvider.endpoint ?? ""}
              placeholder="/chat/completions"
              onChange={(event) => {
                const endpoint = event.target.value;
                updateActiveProvider((provider) => {
                  if (endpoint.length > 0) {
                    return {
                      ...provider,
                      endpoint
                    };
                  }
                  const { endpoint: _ignored, ...rest } = provider;
                  return rest;
                }, "debounced");
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.llm.modelStrategyTitle")}</CardTitle>
          <CardDescription>{t("settings.llm.modelStrategyDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("settings.llm.modelControlMode")}</Label>
              <Select
                value={activeProvider.modelControlMode}
                onValueChange={(value) => {
                  updateActiveProvider((provider) => ({
                    ...provider,
                    modelControlMode: value as LlmProviderConfig["modelControlMode"]
                  }), "immediate");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="intensity">{t("settings.llm.modeIntensity")}</SelectItem>
                  <SelectItem value="manual">{t("settings.llm.modeManual")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>{t("settings.llm.intensity")}</Label>
              <Select
                value={activeProvider.intensity}
                onValueChange={(value) => {
                  updateActiveProvider((provider) => ({
                    ...provider,
                    intensity: value as ProviderIntensityLevel
                  }), "immediate");
                }}
                disabled={activeProvider.modelControlMode !== "intensity"}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="speed">{t("settings.llm.intensitySpeed")}</SelectItem>
                  <SelectItem value="balanced">{t("settings.llm.intensityBalanced")}</SelectItem>
                  <SelectItem value="quality">{t("settings.llm.intensityQuality")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("settings.llm.primaryModel")}</Label>
              {suggestedModels.length > 0 && (
                <Select
                  value=""
                  onValueChange={(value) => updateModelPair("primaryModel", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("settings.llm.selectPresetModel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {suggestedModels.map((modelName) => (
                      <SelectItem key={`primary-${modelName}`} value={modelName}>{modelName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                value={editableModels.primaryModel}
                onChange={(event) => updateModelPair("primaryModel", event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label>{t("settings.llm.secondaryModel")}</Label>
              {suggestedModels.length > 0 && (
                <Select
                  value=""
                  onValueChange={(value) => updateModelPair("secondaryModel", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("settings.llm.selectPresetModel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {suggestedModels.map((modelName) => (
                      <SelectItem key={`secondary-${modelName}`} value={modelName}>{modelName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                value={editableModels.secondaryModel}
                onChange={(event) => updateModelPair("secondaryModel", event.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.llm.connectionTestTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="outline"
            disabled={testStatus === "testing"}
            onClick={() => {
              void handleTestConnection();
            }}
          >
            {testStatus === "testing" ? t("settings.llm.testingConnection") : t("settings.llm.testConnection")}
          </Button>
          {testStatus !== "idle" && (
            <p className={`text-sm ${testStatus === "success" ? "text-green-600" : "text-destructive"}`}>
              {testMessage}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t("settings.llm.currentResolvedModel", { model: resolveProviderModels(activeProvider).primaryModel })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
