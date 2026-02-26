import { useTranslation } from "react-i18next";

import type { ClassificationRule } from "../../../shared/types/rules.js";

interface RuleManagementPanelProps {
  rules: ClassificationRule[];
  onRefreshRules: () => void;
  onToggleRule: (rule: ClassificationRule) => void;
}

export const RuleManagementPanel = ({
  rules,
  onRefreshRules,
  onToggleRule
}: RuleManagementPanelProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <section className="controls">
      <button onClick={onRefreshRules}>{t("rules.refresh")}</button>
      {rules.map((rule) => (
        <button key={rule.id} onClick={() => onToggleRule(rule)}>
          {rule.enabled ? t("rules.disable") : t("rules.enable")} {rule.project}
        </button>
      ))}
    </section>
  );
};
