import * as React from "react";
import { useTranslation } from "react-i18next";
import { Label } from "../../../components/ui/label.js";
import { Input } from "../../../components/ui/input.js";
import type { AppSettings } from "../../../../shared/types/settings.js";

interface AdvancedPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

export const AdvancedPanel = ({
  settings,
  onChange,
}: AdvancedPanelProps): JSX.Element => {
  const { t } = useTranslation();

  const handleWhitelistChange = (value: string) => {
    const directories = value
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    onChange({ ...settings, whitelistDirectories: directories });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-2">
        <Label htmlFor="whitelist-dirs">
          {t("settings.advanced.whitelistDirectories")}
        </Label>
        <Input
          id="whitelist-dirs"
          placeholder={t("settings.advanced.whitelistPlaceholder")}
          value={settings.whitelistDirectories.join(";")}
          onChange={(e) => handleWhitelistChange(e.target.value)}
        />
      </div>
    </div>
  );
};
