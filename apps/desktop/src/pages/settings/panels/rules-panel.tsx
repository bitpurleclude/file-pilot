import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks, RefreshCw } from "lucide-react";

import { Button } from "../../../components/ui/button.js";
import type { ClassificationRule } from "../../../../shared/types/rules.js";

export const RulesPanel = (): JSX.Element => {
  const { t } = useTranslation();
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadRules = useCallback(async (): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined) {
      return;
    }
    const result = await api.listRules({ includeDisabled: true });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setRules(result.data);
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const toggleRule = async (rule: ClassificationRule): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined) {
      return;
    }
    const result = await api.updateRule({ ruleId: rule.id, enabled: !rule.enabled });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setRules((current) => current.map((item) => (item.id === rule.id ? result.data : item)));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{t("settings.rules.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("settings.rules.description")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { void loadRules(); }}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          {t("rules.refresh")}
        </Button>
      </div>

      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      {rules.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 py-10 text-center">
          <ListChecks className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("settings.rules.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{rule.project}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {rule.purpose}
                  {rule.matcher.ext === undefined ? "" : ` · .${rule.matcher.ext}`}
                  {rule.matcher.pathPrefix === undefined ? "" : ` · ${rule.matcher.pathPrefix}`}
                  {` · ${rule.hits} hits`}
                </p>
              </div>
              <Button
                variant={rule.enabled ? "outline" : "secondary"}
                size="sm"
                onClick={() => { void toggleRule(rule); }}
              >
                {rule.enabled ? t("rules.disable") : t("rules.enable")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
