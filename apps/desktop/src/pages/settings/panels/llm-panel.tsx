import * as React from "react";
import { useTranslation } from "react-i18next";
import { Label } from "../../../components/ui/label.js";
import { Input } from "../../../components/ui/input.js";
import { Button } from "../../../components/ui/button.js";
import type { AppSettings } from "../../../../shared/types/settings.js";

interface LlmPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

export const LlmPanel = ({
  settings,
  onChange,
}: LlmPanelProps): JSX.Element => {
  const { t } = useTranslation();

  const handleChange = (key: keyof AppSettings["llm"], value: string) => {
    const next = { ...settings.llm, [key]: value };
    onChange({ ...settings, llm: next });
  };

  const handleTestConnection = () => {
    // Placeholder — will be implemented in Phase 3
    alert("Connection test not implemented yet");
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="llm-baseUrl">
            {t("settings.llm.baseUrl")}
          </Label>
          <Input
            id="llm-baseUrl"
            value={settings.llm.baseUrl}
            onChange={(e) => handleChange("baseUrl", e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="llm-apiKey">
            {t("settings.llm.apiKey")}
          </Label>
          <Input
            id="llm-apiKey"
            type="password"
            placeholder={t("settings.llm.apiKeyPlaceholder")}
            value={settings.llm.apiKey ?? ""}
            onChange={(e) => handleChange("apiKey", e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="llm-primaryModel">
            {t("settings.llm.primaryModel")}
          </Label>
          <Input
            id="llm-primaryModel"
            value={settings.llm.primaryModel}
            onChange={(e) => handleChange("primaryModel", e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="llm-secondaryModel">
            {t("settings.llm.secondaryModel")}
          </Label>
          <Input
            id="llm-secondaryModel"
            value={settings.llm.secondaryModel}
            onChange={(e) => handleChange("secondaryModel", e.target.value)}
          />
        </div>
      </div>

      <Button variant="outline" onClick={handleTestConnection}>
        {t("settings.llm.testConnection")}
      </Button>
    </div>
  );
};
