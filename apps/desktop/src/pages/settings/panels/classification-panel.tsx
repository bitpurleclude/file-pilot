import * as React from "react";
import { useTranslation } from "react-i18next";
import { Label } from "../../../components/ui/label.js";
import { Input } from "../../../components/ui/input.js";
import { Switch } from "../../../components/ui/switch.js";
import type { AppSettings } from "../../../../shared/types/settings.js";

interface ClassificationPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

export const ClassificationPanel = ({
  settings,
  onChange,
}: ClassificationPanelProps): JSX.Element => {
  const { t } = useTranslation();

  const handleChange = (
    key: keyof AppSettings["classification"],
    value: number
  ) => {
    onChange({
      ...settings,
      classification: {
        ...settings.classification,
        [key]: value,
      },
    });
  };

  const handleRuleLearningChange = (
    key: keyof AppSettings["ruleLearning"],
    value: boolean | number
  ) => {
    onChange({
      ...settings,
      ruleLearning: {
        ...settings.ruleLearning,
        [key]: value,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-medium">
          {t("settings.classification.title")}
        </h3>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="highConfidenceMin">
              {t("settings.classification.highConfidenceMin")}
            </Label>
            <Input
              id="highConfidenceMin"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={settings.classification.highConfidenceMin}
              onChange={(e) =>
                handleChange("highConfidenceMin", parseFloat(e.target.value))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mediumConfidenceMin">
              {t("settings.classification.mediumConfidenceMin")}
            </Label>
            <Input
              id="mediumConfidenceMin"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={settings.classification.mediumConfidenceMin}
              onChange={(e) =>
                handleChange("mediumConfidenceMin", parseFloat(e.target.value))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="askThreshold">
              {t("settings.classification.askThreshold")}
            </Label>
            <Input
              id="askThreshold"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={settings.classification.askThreshold}
              onChange={(e) =>
                handleChange("askThreshold", parseFloat(e.target.value))
              }
            />
          </div>
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
              handleRuleLearningChange("enabled", checked)
            }
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="autoApplyThreshold">
            {t("settings.classification.autoApplyThreshold")}
          </Label>
          <Input
            id="autoApplyThreshold"
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={settings.ruleLearning.autoApplyThreshold}
            onChange={(e) =>
              handleRuleLearningChange(
                "autoApplyThreshold",
                parseFloat(e.target.value)
              )
            }
          />
        </div>
      </div>
    </div>
  );
};
