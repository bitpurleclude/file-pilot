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
  return (
    <section className="controls">
      <button onClick={onRefreshRules}>Refresh Rules</button>
      {rules.map((rule) => (
        <button key={rule.id} onClick={() => onToggleRule(rule)}>
          {rule.enabled ? "Disable" : "Enable"} {rule.project}
        </button>
      ))}
    </section>
  );
};

