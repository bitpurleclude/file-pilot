import { useTranslation } from "react-i18next";
import { FileText, FolderOpen, RotateCcw } from "lucide-react";

import { Button } from "../../components/ui/button.js";
import type { AnalyzeData } from "../types.js";

interface PlanCardProps {
  analyzeData: AnalyzeData;
  applyConfirm: boolean;
  readOnly: boolean;
  onApply: () => void;
  onRollback: () => void;
}

const confidenceClass = (band: string | undefined): string => {
  if (band === "high") {
    return "confidence confidence-high";
  }
  if (band === "medium") {
    return "confidence confidence-medium";
  }
  return "confidence confidence-low";
};

const planLabel = (item: AnalyzeData["items"][number]): string => {
  const coordinate = item.plan.coordinate;
  if (coordinate !== undefined) {
    return `${coordinate.areaNumber}-${coordinate.areaName} / ${coordinate.projectNumber}-${coordinate.projectName}`;
  }
  return item.plan.targetPath.split(/[\\/]/).slice(-2).join(" / ");
};

export const PlanCard = ({
  analyzeData,
  applyConfirm,
  readOnly,
  onApply,
  onRollback
}: PlanCardProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <section className="plan-card">
      <div className="plan-head">
        <div>
          <p className="eyebrow">{t("popover.planEyebrow")}</p>
          <p className="plan-title">{t("popover.planTitle", { count: analyzeData.items.length })}</p>
        </div>
        {analyzeData.needsFollowUp && (
          <span className="status-pill status-pill-warm">{t("popover.needsInput")}</span>
        )}
      </div>

      <div className="plan-list">
        {analyzeData.items.slice(0, 4).map((item) => (
          <div key={item.item.id} className="plan-row">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="plan-file">{item.item.name}</p>
              <p className="plan-target">{planLabel(item)}</p>
            </div>
            <span className={confidenceClass(item.classification.confidenceBand)}>
              {item.classification.confidenceBand ?? "low"}
            </span>
          </div>
        ))}
        {analyzeData.items.length > 4 && (
          <p className="plan-more">{t("popover.moreItems", { count: analyzeData.items.length - 4 })}</p>
        )}
      </div>

      <div className="plan-actions">
        <Button variant="ghost" size="sm" onClick={onRollback} disabled={readOnly}>
          <RotateCcw className="h-3.5 w-3.5" />
          {t("actions.rollback")}
        </Button>
        <Button
          size="sm"
          variant={applyConfirm ? "destructive" : "secondary"}
          onClick={onApply}
          disabled={readOnly}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {applyConfirm ? t("actions.confirmApply") : t("actions.apply")}
        </Button>
      </div>
    </section>
  );
};
