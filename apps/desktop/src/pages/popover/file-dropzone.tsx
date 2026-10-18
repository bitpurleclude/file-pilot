import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { FolderUp } from "lucide-react";

interface FileDropzoneProps {
  dragActive: boolean;
  fileCount: number;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPickFiles: () => void;
}

export const FileDropzone = ({
  dragActive,
  fileCount,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onPickFiles
}: FileDropzoneProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <section
      className={`dropzone-card${dragActive ? " is-dragging" : ""}`}
      data-testid="dropzone"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onPickFiles}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPickFiles();
        }
      }}
    >
      <div className="dropzone-icon">
        <FolderUp className="h-5 w-5" />
      </div>
      <div>
        <p className="dropzone-title">{t("dropzone.hint")}</p>
        <p className="dropzone-caption">{t("popover.browseHint")}</p>
      </div>
      {fileCount > 0 && (
        <span className="file-count">{t("popover.filesSelected", { count: fileCount })}</span>
      )}
    </section>
  );
};
