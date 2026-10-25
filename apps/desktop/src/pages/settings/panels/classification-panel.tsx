import * as React from "react";
import { useTranslation } from "react-i18next";
import { Label } from "../../../components/ui/label.js";
import { Input } from "../../../components/ui/input.js";
import { Switch } from "../../../components/ui/switch.js";
import type { AppSettings } from "../../../../shared/types/settings.js";
import type { SettingsDraftChange } from "../settings-change.js";

interface ClassificationPanelProps {
  settings: AppSettings;
  onChange: SettingsDraftChange;
}

interface ThresholdFieldProps {
  id: string;
  label: string;
  value: number;
  onCommit: (value: number) => void;
}

/**
 * 数字阈值输入：本地字符串草稿，失焦/回车时 clamp 到 [0,1] 再提交。
 * 直接绑定数值会在清空与输入 "0." 时发生受控往返吞字。
 */
const ThresholdField = ({ id, label, value, onCommit }: ThresholdFieldProps): JSX.Element => {
  const [draft, setDraft] = React.useState<string>(String(value));

  React.useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (): void => {
    const parsed = parseFloat(draft);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }

    const clamped = Math.min(1, Math.max(0, parsed));
    onCommit(clamped);
    setDraft(String(clamped));
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        step="0.01"
        min="0"
        max="1"
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
  );
};

export const ClassificationPanel = ({
  settings,
  onChange
}: ClassificationPanelProps): JSX.Element => {
  const { t } = useTranslation();

  const commitClassification = (key: keyof AppSettings["classification"], value: number): void => {
    onChange({
      ...settings,
      classification: {
        ...settings.classification,
        [key]: value
      }
    }, "debounced");
  };

  const commitRuleLearning = (key: keyof AppSettings["ruleLearning"], value: number): void => {
    onChange({
      ...settings,
      ruleLearning: {
        ...settings.ruleLearning,
        [key]: value
      }
    }, "debounced");
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-medium">
          {t("settings.classification.title")}
        </h3>
        <div className="grid gap-4">
          <ThresholdField
            id="highConfidenceMin"
            label={t("settings.classification.highConfidenceMin")}
            value={settings.classification.highConfidenceMin}
            onCommit={(value) => commitClassification("highConfidenceMin", value)}
          />
          <ThresholdField
            id="mediumConfidenceMin"
            label={t("settings.classification.mediumConfidenceMin")}
            value={settings.classification.mediumConfidenceMin}
            onCommit={(value) => commitClassification("mediumConfidenceMin", value)}
          />
          <ThresholdField
            id="askThreshold"
            label={t("settings.classification.askThreshold")}
            value={settings.classification.askThreshold}
            onCommit={(value) => commitClassification("askThreshold", value)}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between space-x-2">
          <Label htmlFor="ruleLearningEnabled">
            {t("settings.classification.ruleLearningEnabled")}
          </Label>
          <Switch
            id="ruleLearningEnabled"
            checked={settings.ruleLearning.enabled}
            onCheckedChange={(checked) =>
              onChange({
                ...settings,
                ruleLearning: { ...settings.ruleLearning, enabled: checked }
              }, "immediate")
            }
          />
        </div>

        <ThresholdField
          id="autoApplyThreshold"
          label={t("settings.classification.autoApplyThreshold")}
          value={settings.ruleLearning.autoApplyThreshold}
          onCommit={(value) => commitRuleLearning("autoApplyThreshold", value)}
        />
      </div>
    </div>
  );
};
