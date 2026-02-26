import * as React from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Edit2, RotateCw, Check, X, Server, ArrowLeft } from "lucide-react";

import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import { Switch } from "../../../components/ui/switch.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";

import type { AppSettings } from "../../../../shared/types/settings.js";
import type { LlmProviderConfig, ProviderProtocol, ProviderAuthType } from "../../../../shared/types/llm-provider.js";
import {
  LLM_PROVIDER_PRESETS,
  getAllProviderPresets,
} from "../../../../shared/config/llm-providers.js";

interface ProvidersPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

export const ProvidersPanel = ({
  settings,
  onChange,
}: ProvidersPanelProps): JSX.Element => {
  const { t } = useTranslation();
  const [editId, setEditId] = React.useState<string | null>(null);
  const [isAdding, setIsAdding] = React.useState(false);
  
  // Test connection state
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{ id: string; success: boolean; message?: string } | null>(null);
  const [selectValue, setSelectValue] = React.useState("");

  const isMultiProvider = settings.llmProviders !== undefined;
  const providers = settings.llmProviders?.providers ?? [];
  const activeId = settings.llmProviders?.activeProviderId;

  // Toggle Multi-Provider Mode
  const handleToggleMultiProvider = (enabled: boolean) => {
    if (enabled) {
      // Initialize with default or current LLM settings if possible
      // For now, we'll start with an empty list or a default OpenAI preset
      const defaultPreset = LLM_PROVIDER_PRESETS["openai"];
      if (!defaultPreset) return; // Should not happen
const defaultProvider: LlmProviderConfig = {
id: crypto.randomUUID(), // Unique ID for the instance
name: defaultPreset.name,
isPreset: true,
baseUrl: settings.llm.baseUrl || defaultPreset.baseUrl,
authType: defaultPreset.authType,
protocol: defaultPreset.protocol,
primaryModel: defaultPreset.defaultPrimaryModel,
secondaryModel: defaultPreset.defaultSecondaryModel,
        enabled: true,
        // Handle optional fields with conditional spread or defaults if type allows
        ...(settings.llm.apiKey ? {
        apiKey: settings.llm.apiKey } : {}),
        ...(defaultPreset.endpoint ? {
        endpoint: defaultPreset.endpoint } : {}),
        ...(defaultPreset.customHeaders ? {
        customHeaders: defaultPreset.customHeaders } : {}),
};

      onChange({
        ...settings,
        llmProviders: {
          activeProviderId: defaultProvider.id,
          providers: [defaultProvider],
        },
      });
    } else {
      // Disable multi-provider mode (set to undefined)
      // We might want to warn the user, but for now just toggle
      // Disable multi-provider mode (remove llmProviders)
      const { llmProviders, ...rest } = settings;
      onChange(rest as AppSettings);
    }
  };

  const handleSetActive = (id: string) => {
    if (!settings.llmProviders) return;
    onChange({
      ...settings,
      llmProviders: {
        ...settings.llmProviders,
        activeProviderId: id,
      },
    });
  };

  const handleToggleEnabled = (id: string, enabled: boolean) => {
    if (!settings.llmProviders) return;
    const newProviders = providers.map((p) =>
      p.id === id ? { ...p, enabled } : p
    );
    onChange({
      ...settings,
      llmProviders: {
        ...settings.llmProviders,
        providers: newProviders,
      },
    });
  };

  const handleDelete = (id: string) => {
    if (!settings.llmProviders) return;
    if (confirm(t("settings.providers.deleteConfirm", "Are you sure?"))) {
      const newProviders = providers.filter((p) => p.id !== id);
      // If we deleted the active provider, reset activeId or pick first
      let newActiveId = activeId;
      if (activeId === id) {
        newActiveId = newProviders[0]?.id ?? "";
      }
      onChange({
        ...settings,
        llmProviders: {
          activeProviderId: newActiveId ?? "",
          providers: newProviders,
        },
      });
    }
  };

  const handleSaveProvider = (provider: LlmProviderConfig) => {
    if (!settings.llmProviders) return;
    
    let newProviders = [...providers];
    const existingIndex = newProviders.findIndex((p) => p.id === provider.id);
    
    if (existingIndex >= 0) {
      newProviders[existingIndex] = provider;
    } else {
      newProviders.push(provider);
    }

    onChange({
      ...settings,
      llmProviders: {
        ...settings.llmProviders,
        providers: newProviders,
      },
    });
    setEditId(null);
    setIsAdding(false);
  };

  const handleTestConnection = async (provider: LlmProviderConfig) => {
    setTestingId(provider.id);
    setTestResult(null);
    
    // Placeholder for actual test logic
    try {
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1000));
        // For now, success if apiKey is present
        if (provider.apiKey) {
            setTestResult({ id: provider.id, success: true });
        } else {
            throw new Error("Missing API Key");
        }
    } catch (err) {
        setTestResult({ id: provider.id, success: false, message: (err as Error).message });
    } finally {
        setTestingId(null);
    }
  };

  // Views
  if (!isMultiProvider) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.providers.title")}</CardTitle>
          <CardDescription>
            {t("settings.providers.useMultiProviderDesc", "Enable multi-provider mode to manage multiple LLM configurations.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2">
            <Switch
              id="multi-provider-mode"
              checked={isMultiProvider}
              onCheckedChange={handleToggleMultiProvider}
            />
            <Label htmlFor="multi-provider-mode">
              {t("settings.providers.useMultiProvider")}
            </Label>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Editing or Adding View
  if (editId || isAdding) {
    const editingProvider = editId 
      ? providers.find(p => p.id === editId) 
      : {
          id: crypto.randomUUID(),
          name: "New Provider",
          isPreset: false,
          baseUrl: "",
          authType: "bearer" as ProviderAuthType,
          protocol: "openai" as ProviderProtocol,
          primaryModel: "",
          secondaryModel: "",
          enabled: true,
          apiKey: "",
        };

    return (
      <ProviderEditor
        initialProvider={editingProvider!} // Bang is safe because if editId is set, provider must exist (or we handle edge case)
        onSave={handleSaveProvider}
        onCancel={() => {
          setEditId(null);
          setIsAdding(false);
        }}
        presets={getAllProviderPresets()}
      />
    );
  }

  // List View
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="space-y-1">
            <CardTitle>{t("settings.providers.title")}</CardTitle>
            <CardDescription>
               {t("settings.providers.manageDesc", "Manage your LLM providers.")}
            </CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="multi-provider-mode-active" className="text-sm font-normal">
               {t("settings.providers.useMultiProvider")}
            </Label>
            <Switch
              id="multi-provider-mode-active"
              checked={isMultiProvider}
              onCheckedChange={handleToggleMultiProvider}
            />
          </div>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              {t("settings.providers.noProviders")}
            </div>
          ) : (
            <div className="grid gap-4">
              {providers.map((provider) => (
                <Card key={provider.id} className={`flex flex-col sm:flex-row items-start sm:items-center p-4 gap-4 ${activeId === provider.id ? 'border-primary/50 bg-accent/5' : ''}`}>
                   <div className="flex items-center h-full">
                      <div 
                        className={`w-4 h-4 rounded-full border border-primary cursor-pointer flex items-center justify-center ${activeId === provider.id ? 'bg-primary text-primary-foreground' : 'opacity-50 hover:opacity-100'}`}
                        onClick={() => handleSetActive(provider.id)}
                      >
                        {activeId === provider.id && <div className="w-2 h-2 rounded-full bg-current" />}
                      </div>
                   </div>
                   
                   <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{provider.name}</span>
                        {provider.isPreset && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">Preset</span>}
                        {activeId === provider.id && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Active</span>}
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-2">
                         <span>{provider.protocol}</span>
                         <span>•</span>
                         <span>{provider.primaryModel}</span>
                      </div>
                   </div>

                   <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                      <Button variant="ghost" size="icon" onClick={() => handleTestConnection(provider)} title={t("settings.providers.testConnection")}>
                        {testingId === provider.id ? <RotateCw className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
                      </Button>
                      <Switch 
                        checked={provider.enabled} 
                        onCheckedChange={(c) => handleToggleEnabled(provider.id, c)}
                      />
                      <Button variant="ghost" size="icon" onClick={() => setEditId(provider.id)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(provider.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                   </div>
                   {testResult?.id === provider.id && (
                     <div className={`absolute bottom-1 right-4 text-xs ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
                        {testResult.success ? t("settings.providers.testSuccess") : t("settings.providers.testFailed", { message: testResult.message })}
                     </div>
                   )}
                </Card>
              ))}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <div className="w-full flex justify-end gap-2">
            <Select 
              value={selectValue}
              onValueChange={(value) => {
               setSelectValue(""); // Reset selection
               if (value === "custom") {
                 setIsAdding(true);
               } else {
                 const preset = LLM_PROVIDER_PRESETS[value];
                 if (preset) {
                   const newProvider: LlmProviderConfig = {
                     id: crypto.randomUUID(),
                     name: preset.name,
                     isPreset: true,
                     baseUrl: preset.baseUrl,
                     authType: preset.authType,
                     protocol: preset.protocol,
                     primaryModel: preset.defaultPrimaryModel,
                     secondaryModel: preset.defaultSecondaryModel,
                     enabled: true,
                     // Optional fields
                     ...(preset.requiresApiKey ? { apiKey: "" } : {}), 
                     ...(preset.endpoint ? { endpoint: preset.endpoint } : {}),
                     ...(preset.customHeaders ? { customHeaders: preset.customHeaders } : {}),
                   };
                   handleSaveProvider(newProvider);
                 }
               }
            }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("settings.providers.addProvider")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">{t("settings.providers.custom")}</SelectItem>
                {getAllProviderPresets().map(preset => (
                  <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
};

// Sub-component for editing
interface ProviderEditorProps {
  initialProvider: LlmProviderConfig;
  onSave: (provider: LlmProviderConfig) => void;
  onCancel: () => void;
  presets: ReturnType<typeof getAllProviderPresets>;
}

const ProviderEditor = ({ initialProvider, onSave, onCancel, presets }: ProviderEditorProps) => {
  const { t } = useTranslation();
  const [provider, setProvider] = React.useState<LlmProviderConfig>(initialProvider);

  const handleChange = (key: keyof LlmProviderConfig, value: any) => {
    setProvider(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onCancel} className="h-8 w-8 -ml-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle>{provider.id === initialProvider.id && initialProvider.name !== "New Provider" ? t("settings.providers.edit") : t("settings.providers.addProvider")}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="provider-name">{t("settings.providers.providerName")}</Label>
          <Input 
            id="provider-name" 
            value={provider.name} 
            onChange={(e) => handleChange("name", e.target.value)} 
          />
        </div>
        
        <div className="grid gap-2">
          <Label htmlFor="base-url">{t("settings.llm.baseUrl")}</Label>
          <Input 
            id="base-url" 
            value={provider.baseUrl} 
            onChange={(e) => handleChange("baseUrl", e.target.value)} 
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="api-key">{t("settings.llm.apiKey")}</Label>
          <Input 
            id="api-key" 
            type="password"
            value={provider.apiKey || ""} 
            onChange={(e) => handleChange("apiKey", e.target.value)} 
            placeholder={t("settings.llm.apiKeyPlaceholder")}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="primary-model">{t("settings.llm.primaryModel")}</Label>
            <Input 
              id="primary-model" 
              value={provider.primaryModel} 
              onChange={(e) => handleChange("primaryModel", e.target.value)} 
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="secondary-model">{t("settings.llm.secondaryModel")}</Label>
            <Input 
              id="secondary-model" 
              value={provider.secondaryModel} 
              onChange={(e) => handleChange("secondaryModel", e.target.value)} 
            />
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>{t("settings.back")}</Button>
        <Button onClick={() => onSave(provider)}>{t("settings.save")}</Button>
      </CardFooter>
    </Card>
  );
};
