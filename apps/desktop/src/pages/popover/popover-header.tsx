import { useTranslation } from "react-i18next";
import { Minus, Settings, ShieldCheck, Sparkles } from "lucide-react";

interface PopoverHeaderProps {
  readOnly: boolean;
  onOpenSettings: () => void;
  onHide: () => void;
}

export const PopoverHeader = ({
  readOnly,
  onOpenSettings,
  onHide
}: PopoverHeaderProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <header className="popover-header app-drag">
      <div className="brand-lockup">
        <div className="brand-mark">
          <Sparkles className="h-4 w-4" strokeWidth={2.2} />
        </div>
        <div>
          <h1 className="brand-name">{t("app.title")}</h1>
          <p className="brand-caption">
            {readOnly ? t("status.readOnly") : t("popover.ready")}
          </p>
        </div>
      </div>
      <div className="app-no-drag flex items-center gap-1">
        {readOnly && (
          <span data-testid="status-read-only" className="status-pill">
            <ShieldCheck className="h-3 w-3" />
            {t("status.readOnly")}
          </span>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t("settings.title")}
          data-testid="open-settings"
          onClick={onOpenSettings}
        >
          <Settings className="h-4 w-4" />
        </button>
        <button type="button" className="icon-button" aria-label="Hide" onClick={onHide}>
          <Minus className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};
