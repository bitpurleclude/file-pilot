import { useTranslation } from "react-i18next";

interface FirstRunWizardProps {
  visible: boolean;
  step: 1 | 2 | 3;
  whitelistInput: string;
  riskAccepted: boolean;
  onWhitelistInputChange: (value: string) => void;
  onRiskAcceptedChange: (value: boolean) => void;
  onStepChange: (step: 1 | 2 | 3) => void;
  onSkipReadOnly: () => void;
  onSaveWhitelist: () => void;
}

export const FirstRunWizard = ({
  visible,
  step,
  whitelistInput,
  riskAccepted,
  onWhitelistInputChange,
  onRiskAcceptedChange,
  onStepChange,
  onSkipReadOnly,
  onSaveWhitelist
}: FirstRunWizardProps): JSX.Element | null => {
  const { t } = useTranslation();

  if (!visible) {
    return null;
  }

  return (
    <section className="wizard">
      <h2>{t("wizard.title", { step })}</h2>

      {step === 1 && (
        <>
          <p>{t("wizard.step1Hint")}</p>
          <input
            id="wizard-whitelist-input"
            name="wizardWhitelistInput"
            placeholder={t("wizard.step1Placeholder")}
            value={whitelistInput}
            onChange={(event) => onWhitelistInputChange(event.target.value)}
          />
          <div className="controls">
            <button
              onClick={() => onStepChange(2)}
              disabled={whitelistInput.trim().length === 0}
            >
              {t("wizard.next")}
            </button>
            <button onClick={onSkipReadOnly}>{t("wizard.skipReadOnly")}</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p>{t("wizard.step2Notice")}</p>
          <label>
            <input
              id="wizard-risk-accepted"
              name="wizardRiskAccepted"
              type="checkbox"
              checked={riskAccepted}
              onChange={(event) => onRiskAcceptedChange(event.target.checked)}
            />
            {t("wizard.step2Accept")}
          </label>
          <div className="controls">
            <button onClick={() => onStepChange(1)}>{t("wizard.back")}</button>
            <button onClick={() => onStepChange(3)} disabled={!riskAccepted}>{t("wizard.next")}</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <p>{t("wizard.step3Confirm")}</p>
          <div className="controls">
            <button onClick={() => onStepChange(2)}>{t("wizard.back")}</button>
            <button onClick={onSaveWhitelist}>{t("wizard.confirm")}</button>
          </div>
        </>
      )}
    </section>
  );
};
