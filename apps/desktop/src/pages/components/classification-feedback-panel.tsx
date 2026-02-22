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
  if (analyzeData === null) {
    return null;
  }

  return (
    <>
      {analyzeData.needsFollowUp && (
        <section className="controls">
          <input
            value={followupAnswer}
            onChange={(event) => onFollowupAnswerChange(event.target.value)}
            placeholder="Follow-up answer for low confidence items"
          />
          <button onClick={onSubmitFollowup}>Submit Follow-up</button>
        </section>
      )}

      {firstItemId !== undefined && (
        <section className="controls">
          <label>
            Purpose
            <select
              value={correctionPurpose}
              onChange={(event) => onCorrectionPurposeChange(event.target.value as Purpose)}
            >
              {purposeOptions.map((purpose) => (
                <option key={purpose} value={purpose}>{purpose}</option>
              ))}
            </select>
          </label>
          <input
            value={correctionProject}
            onChange={(event) => onCorrectionProjectChange(event.target.value)}
            placeholder="Corrected project"
          />
          <label>
            <input
              type="checkbox"
              checked={saveAsRule}
              onChange={(event) => onSaveAsRuleChange(event.target.checked)}
            />
            Save as rule
          </label>
          <button onClick={onSaveCorrection}>Save Correction</button>
        </section>
      )}
    </>
  );
};

