import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";

interface PopoverFooterProps {
  onOpenWorkspace: () => void;
  onNewSession: () => void;
}

export const PopoverFooter = ({
  onOpenWorkspace,
  onNewSession
}: PopoverFooterProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <footer className="popover-footer">
      <button type="button" className="footer-action" onClick={onOpenWorkspace}>
        <FolderOpen className="h-3.5 w-3.5" />
        {t("popover.openWorkspace")}
      </button>
      <button type="button" className="footer-action" onClick={onNewSession}>
        {t("actions.newSession")}
      </button>
      <span className="footer-note">{t("popover.localFirst")}</span>
    </footer>
  );
};
