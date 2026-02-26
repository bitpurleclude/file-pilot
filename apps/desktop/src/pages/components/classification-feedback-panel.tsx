import { useTranslation } from "react-i18next";

import type { Purpose } from "../../../shared/types/workflow.js";
import type { AnalyzeData } from "../types.js";

interface ClassificationFeedbackPanelProps {
  analyzeData: AnalyzeData | null;
  firstItemId: string | undefined;
  followupAnswer: string;
  onFollowupAnswerChange: (value: string) => void;
  onSubmitFollowup: () => void;
  correctionPurpose: Purpose;
  purposeOptions: Purpose[];
  onCorrectionPurposeChange: (value: Purpose) => void;
  correctionProject: string;
  onCorrectionProjectChange: (value: string) => void;
  saveAsRule: boolean;
  onSaveAsRuleChange: (value: boolean) => void;
  onSaveCorrection: () => void;
}

export const ClassificationFeedbackPanel = ({
  analyzeData,
  firstItemId,
  followupAnswer,
  onFollowupAnswerChange,
  onSubmitFollowup,
  correctionPurpose,
  purposeOptions,
  onCorrectionPurposeChange,
  correctionProject,
  onCorrectionProjectChange,
  saveAsRule,
  onSaveAsRuleChange,
  onSaveCorrection
}: ClassificationFeedbackPanelProps): JSX.Element | null => {
  const { t } = useTranslation();

  if (analyzeData === null) {
    return null;
  }

  return (
    <>
      {analyzeData.needsFollowUp && (
        <section className="controls">
          <input
            id="followup-answer"
            name="followupAnswer"
            value={followupAnswer}
            onChange={(event) => onFollowupAnswerChange(event.target.value)}
            placeholder={t("feedback.followupPlaceholder")}
          />
          <button onClick={onSubmitFollowup}>{t("feedback.submitFollowup")}</button>
        </section>
      )}

      {firstItemId !== undefined && (
        <section className="controls">
          <label>
            {t("feedback.purpose")}
            <select
              id="correction-purpose"
              name="correctionPurpose"
              value={correctionPurpose}
              onChange={(event) => onCorrectionPurposeChange(event.target.value as Purpose)}
            >
              {purposeOptions.map((purpose) => (
                <option key={purpose} value={purpose}>{purpose}</option>
              ))}
            </select>
          </label>
          <input
            id="correction-project"
            name="correctionProject"
            value={correctionProject}
            onChange={(event) => onCorrectionProjectChange(event.target.value)}
            placeholder={t("feedback.correctionProjectPlaceholder")}
          />
          <label>
            <input
              id="save-as-rule"
              name="saveAsRule"
              type="checkbox"
              checked={saveAsRule}
              onChange={(event) => onSaveAsRuleChange(event.target.checked)}
            />
            {t("feedback.saveAsRule")}
          </label>
          <button onClick={onSaveCorrection}>{t("feedback.saveCorrection")}</button>
        </section>
      )}
    </>
  );
};
