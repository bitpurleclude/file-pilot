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
  if (!visible) {
    return null;
  }

  return (
    <section className="wizard">
      <h2>First Run Whitelist Setup ({step} / 3)</h2>

      {step === 1 && (
        <>
          <p>Select allowed directories (split with `;`).</p>
          <input
            placeholder="Example: D:/Workspace;D:/Study"
            value={whitelistInput}
            onChange={(event) => onWhitelistInputChange(event.target.value)}
          />
          <div className="controls">
            <button onClick={() => onStepChange(2)}>Next</button>
            <button onClick={onSkipReadOnly}>Skip (Read-only)</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p>Risk notice: operations are limited to whitelisted directories.</p>
          <label>
            <input
              type="checkbox"
              checked={riskAccepted}
              onChange={(event) => onRiskAcceptedChange(event.target.checked)}
            />
            I have read and accepted the risk notice.
          </label>
          <div className="controls">
            <button onClick={() => onStepChange(1)}>Back</button>
            <button onClick={() => onStepChange(3)} disabled={!riskAccepted}>Next</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <p>Confirm to save whitelist and enable normal mode.</p>
          <div className="controls">
            <button onClick={() => onStepChange(2)}>Back</button>
            <button onClick={onSaveWhitelist}>Confirm</button>
          </div>
        </>
      )}
    </section>
  );
};

