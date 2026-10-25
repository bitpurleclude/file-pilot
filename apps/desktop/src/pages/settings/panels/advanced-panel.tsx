import * as React from "react";
import { useTranslation } from "react-i18next";
import { Label } from "../../../components/ui/label.js";
import { Input } from "../../../components/ui/input.js";
import type { AppSettings } from "../../../../shared/types/settings.js";
import type { SettingsDraftChange } from "../settings-change.js";

interface AdvancedPanelProps {
  settings: AppSettings;
  onChange: SettingsDraftChange;
}

export const AdvancedPanel = ({
  settings,
  onChange
}: AdvancedPanelProps): JSX.Element => {
  const { t } = useTranslation();

  // 本地字符串草稿，失焦/回车时才解析提交：避免防抖保存回写
  // 在输入中途重写输入框（吃掉尾部未输完的部分）。
  const joined = settings.whitelistDirectories.join(";");
  const [draft, setDraft] = React.useState<string>(joined);

  React.useEffect(() => {
    setDraft(joined);
  }, [joined]);

  const commit = (): void => {
    const directories = draft
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    onChange({ ...settings, whitelistDirectories: directories }, "debounced");
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
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
            }
          }}
        />
      </div>
    </div>
  );
};
