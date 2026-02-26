import * as React from "react";
import { useTranslation } from "react-i18next";
import { Label } from "../../../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { Switch } from "../../../components/ui/switch.js";
import type { AppSettings } from "../../../../shared/types/settings.js";

interface GeneralPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

export const GeneralPanel = ({
  settings,
  onChange,
}: GeneralPanelProps): JSX.Element => {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (value: string) => {
    const newLang = value as "zh-CN" | "en";
    onChange({
      ...settings,
      language: newLang,
    });
    void i18n.changeLanguage(newLang);
  };

  const handleReadOnlyChange = (checked: boolean) => {
    onChange({
      ...settings,
      readOnlyMode: checked,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>{t("settings.general.language")}</Label>
        <Select
          value={settings.language}
          onValueChange={handleLanguageChange}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-CN">
              {t("settings.general.languageZh")}
            </SelectItem>
            <SelectItem value="en">
              {t("settings.general.languageEn")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between space-x-2">
        <div className="space-y-0.5">
          <Label>{t("settings.general.readOnlyMode")}</Label>
          <p className="text-sm text-muted-foreground">
            {t("settings.general.readOnlyModeDesc")}
          </p>
        </div>
        <Switch
          checked={settings.readOnlyMode}
          onCheckedChange={handleReadOnlyChange}
        />
      </div>
    </div>
  );
};
