import * as React from "react";
import { useTranslation } from "react-i18next";

import type { DedupEvidence, RegistryProposalDto } from "../../../../shared/ipc/contracts.js";
import type { RegistryArea, RegistryProject } from "../../../../shared/types/registry.js";
import { AREA_NUMBER_MAX, AREA_NUMBER_MIN } from "../../../../shared/types/registry.js";
import { isRegistryNameValid } from "../../../../shared/validation/registry.js";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";

/** Debounce window for the live check-duplicate input (task spec: 300ms). */
const DEDUP_DEBOUNCE_MS = 300;

interface DedupState {
  scope: "area" | "project";
  evidence: DedupEvidence[];
  checking: boolean;
}

const extractEvidence = (details: Record<string, unknown> | undefined): DedupEvidence[] => {
  if (details === undefined) {
    return [];
  }

  const raw = details.evidence;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is DedupEvidence =>
    typeof item === "object"
    && item !== null
    && typeof (item as DedupEvidence).level === "string"
    && typeof (item as DedupEvidence).matchedName === "string"
    && typeof (item as DedupEvidence).matchedKind === "string"
  );
};

const describeError = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

const nextFreeAreaNumber = (areas: RegistryArea[]): number | null => {
  const occupied = new Set(areas.map((area) => area.number));
  for (let candidate = AREA_NUMBER_MIN; candidate <= AREA_NUMBER_MAX; candidate += 10) {
    if (!occupied.has(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const RegistryPanel = (): JSX.Element => {
  const { t } = useTranslation();
  const [areas, setAreas] = React.useState<RegistryArea[]>([]);
  const [projects, setProjects] = React.useState<RegistryProject[]>([]);
  const [proposals, setProposals] = React.useState<RegistryProposalDto[]>([]);
  const [hiddenProposalIds, setHiddenProposalIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<DedupEvidence[]>([]);
  const [collapsedAreaIds, setCollapsedAreaIds] = React.useState<string[]>([]);

  const [newAreaName, setNewAreaName] = React.useState<string>("");
  const [newProjectName, setNewProjectName] = React.useState<string>("");
  const [selectedAreaId, setSelectedAreaId] = React.useState<string>("");
  const [dedup, setDedup] = React.useState<DedupState | null>(null);

  const dedupTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const dedupSeqRef = React.useRef<number>(0);

  React.useEffect(() => {
    return () => {
      if (dedupTimerRef.current !== null) {
        clearTimeout(dedupTimerRef.current);
      }
    };
  }, []);

  const load = React.useCallback(async (): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined) {
      setError("IPC not ready");
      return;
    }

    setLoading(true);
    try {
      const [listResult, proposalsResult] = await Promise.all([api.registryList(), api.registryProposals()]);
      if (!listResult.ok) {
        setError(listResult.error.message);
        return;
      }
      if (!proposalsResult.ok) {
        setError(proposalsResult.error.message);
        return;
      }

      setError(null);
      setAreas(listResult.data.areas);
      setProjects(listResult.data.projects);
      setProposals(proposalsResult.data.proposals);
      setSelectedAreaId((current) => (
        listResult.data.areas.some((area) => area.id === current && area.status === "active")
          ? current
          : ""
      ));
    } catch (error) {
      setError(describeError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const runDedup = async (scope: "area" | "project", name: string): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined) {
      return;
    }

    const seq = dedupSeqRef.current + 1;
    dedupSeqRef.current = seq;
    setDedup({ scope, evidence: [], checking: true });

    try {
      const result = await api.registryCheckDuplicate({ name });
      if (seq !== dedupSeqRef.current) {
        return;
      }
      if (!result.ok) {
        setError(result.error.message);
        setDedup(null);
        return;
      }
      setDedup({ scope, evidence: result.data.evidence, checking: false });
    } catch (error) {
      if (seq === dedupSeqRef.current) {
        setError(describeError(error));
        setDedup(null);
      }
    }
  };

  const scheduleDedup = (scope: "area" | "project", name: string): void => {
    if (dedupTimerRef.current !== null) {
      clearTimeout(dedupTimerRef.current);
      dedupTimerRef.current = null;
    }
    if (!isRegistryNameValid(name)) {
      setDedup(null);
      return;
    }
    dedupTimerRef.current = setTimeout(() => {
      void runDedup(scope, name);
    }, DEDUP_DEBOUNCE_MS);
  };

  const handleCreateArea = async (): Promise<void> => {
    const api = window.filePilotApi;
    const name = newAreaName.trim();
    if (api === undefined || name.length === 0) {
      return;
    }

    try {
      const result = await api.registryCreateArea({ name });
      if (!result.ok) {
        setError(result.error.message);
        setWarnings(extractEvidence(result.error.details));
        return;
      }

      setError(null);
      setWarnings(result.data.warnings);
      setNewAreaName("");
      setDedup(null);
      await load();
    } catch (error) {
      setError(describeError(error));
    }
  };

  const handleCreateProject = async (): Promise<void> => {
    const api = window.filePilotApi;
    const name = newProjectName.trim();
    if (api === undefined || selectedAreaId.length === 0 || name.length === 0) {
      return;
    }

    try {
      const result = await api.registryCreateProject({ areaId: selectedAreaId, name });
      if (!result.ok) {
        setError(result.error.message);
        setWarnings(extractEvidence(result.error.details));
        return;
      }

      setError(null);
      setWarnings(result.data.warnings);
      setNewProjectName("");
      setDedup(null);
      await load();
    } catch (error) {
      setError(describeError(error));
    }
  };

  const handleArchive = async (kind: "area" | "project", id: string): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined) {
      return;
    }

    try {
      const result = await api.registryArchive({ kind, id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await load();
    } catch (error) {
      setError(describeError(error));
    }
  };

  const handleAcceptProposal = async (proposal: RegistryProposalDto, areaId: string): Promise<void> => {
    const api = window.filePilotApi;
    if (api === undefined || areaId.length === 0) {
      return;
    }

    try {
      const result = await api.registryCreateProject({ areaId, name: proposal.proposedName });
      if (!result.ok) {
        setError(result.error.message);
        setWarnings(extractEvidence(result.error.details));
        return;
      }

      setError(null);
      setHiddenProposalIds((current) => [...current, proposal.id]);
      await load();
    } catch (error) {
      setError(describeError(error));
    }
  };

  const handleIgnoreProposal = (proposalId: string): void => {
    setHiddenProposalIds((current) => [...current, proposalId]);
  };

  const toggleArea = (areaId: string): void => {
    setCollapsedAreaIds((current) => (
      current.includes(areaId)
        ? current.filter((id) => id !== areaId)
        : [...current, areaId]
    ));
  };

  const renderEvidenceLine = (item: DedupEvidence): string => {
    const kindLabel = item.matchedKind === "area" ? t("registry.areas") : t("registry.projects");
    const scoreText = item.score === undefined ? "" : ` (${item.score})`;
    return `${t(`registry.level.${item.level}`)} · ${kindLabel}「${item.matchedName}」 — ${item.detail}${scoreText}`;
  };

  const hintNumber = nextFreeAreaNumber(areas);
  const areaNameValid = isRegistryNameValid(newAreaName);
  const projectNameValid = isRegistryNameValid(newProjectName);
  const visibleProposals = proposals.filter((proposal) => !hiddenProposalIds.includes(proposal.id));
  const activeAreas = areas.filter((area) => area.status === "active");
  const projectsOf = (area: RegistryArea): RegistryProject[] =>
    projects.filter((project) => project.areaId === area.id);

  return (
    <div className="space-y-6">
      {error !== null && (
        <p data-testid="registry-error" className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">{t("registry.title")}</h3>
        <Button variant="outline" size="sm" data-testid="registry-refresh" onClick={() => void load()}>
          {t("registry.refresh")}
        </Button>
      </div>

      <div className="space-y-2" data-testid="registry-area-list">
        {areas.length === 0 && (
          <p data-testid="registry-empty" className="text-sm text-muted-foreground">
            {t("registry.empty")}
          </p>
        )}
        {areas.map((area) => {
          const areaProjects = projectsOf(area);
          const collapsed = collapsedAreaIds.includes(area.id);
          return (
            <div key={area.id} data-testid="registry-area-item" className="rounded-md border p-3">
              <div className="flex items-center gap-3">
                <span data-testid="registry-area-name" className="font-medium">
                  {area.number}-{area.name}
                  {area.status === "archived" ? `（${t("registry.archived")}）` : ""}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("registry.projectCount", { total: areaProjects.length })}
                </span>
                <span className="flex-1" />
                {area.status === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`registry-archive-area-${area.id}`}
                    onClick={() => void handleArchive("area", area.id)}
                  >
                    {t("registry.archive")}
                  </Button>
                )}
                <Button variant="ghost" size="sm" data-testid={`registry-toggle-area-${area.id}`} onClick={() => toggleArea(area.id)}>
                  {collapsed ? "+" : "-"}
                </Button>
              </div>
              {!collapsed && (
                <ul className="ml-6 mt-2 space-y-1">
                  {areaProjects.map((project) => (
                    <li key={project.id} className="flex items-center gap-2">
                      <span data-testid="registry-project-name">
                        {project.number}-{project.name}
                        {project.status === "archived" ? `（${t("registry.archived")}）` : ""}
                      </span>
                      <span className="flex-1" />
                      {project.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`registry-archive-project-${project.id}`}
                          onClick={() => void handleArchive("project", project.id)}
                        >
                          {t("registry.archive")}
                        </Button>
                      )}
                    </li>
                  ))}
                  {areaProjects.length === 0 && (
                    <li className="text-sm text-muted-foreground">{t("registry.noProjects")}</li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <Label htmlFor="registry-new-area-name">{t("registry.newAreaName")}</Label>
        <Input
          id="registry-new-area-name"
          data-testid="registry-new-area-name"
          value={newAreaName}
          onChange={(event) => {
            setNewAreaName(event.target.value);
            scheduleDedup("area", event.target.value);
          }}
        />
        {newAreaName.trim().length > 0 && hintNumber !== null && (
          <p data-testid="registry-next-slot-hint" className="text-sm text-muted-foreground">
            {t("registry.nextSlotHint", { slot: hintNumber, name: newAreaName.trim() })}
          </p>
        )}
        <Button
          data-testid="registry-create-area"
          disabled={!areaNameValid || loading}
          onClick={() => void handleCreateArea()}
        >
          {t("registry.createArea")}
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="registry-new-project-name">{t("registry.newProjectName")}</Label>
        <select
          data-testid="registry-new-project-area"
          value={selectedAreaId}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setSelectedAreaId(event.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{t("registry.selectArea")}</option>
          {activeAreas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.number}-{area.name}
            </option>
          ))}
        </select>
        <Input
          id="registry-new-project-name"
          data-testid="registry-new-project-name"
          value={newProjectName}
          onChange={(event) => {
            setNewProjectName(event.target.value);
            scheduleDedup("project", event.target.value);
          }}
        />
        <Button
          data-testid="registry-create-project"
          disabled={selectedAreaId.length === 0 || !projectNameValid || loading}
          onClick={() => void handleCreateProject()}
        >
          {t("registry.createProject")}
        </Button>
      </div>

      {dedup !== null && (
        <div data-testid="registry-dedup-evidence" className="rounded-md border p-3 text-sm">
          {dedup.checking ? (
            <p className="text-muted-foreground">{t("registry.dedupChecking")}</p>
          ) : dedup.evidence.length === 0 ? (
            <p className="text-muted-foreground">{t("registry.dedupClean")}</p>
          ) : (
            <ul className="space-y-1">
              {dedup.evidence.map((item, index) => (
                <li key={`${item.matchedName}-${index}`}>{renderEvidenceLine(item)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div data-testid="registry-warnings" className="rounded-md border border-amber-500/50 p-3 text-sm">
          <p className="font-medium">{t("registry.warningsTitle")}</p>
          <ul className="mt-1 space-y-1">
            {warnings.map((item, index) => (
              <li key={`${item.matchedName}-${index}`}>{renderEvidenceLine(item)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2" data-testid="registry-proposals">
        <h4 className="font-medium">{t("registry.proposalsTitle")}</h4>
        {visibleProposals.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("registry.proposalsEmpty")}</p>
        )}
        {visibleProposals.map((proposal) => (
          <div key={proposal.id} data-testid={`registry-proposal-${proposal.id}`} className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <span data-testid="registry-proposal-name">{proposal.proposedName}</span>
            <span className="text-muted-foreground">
              {t("registry.proposalMeta", { purpose: proposal.purpose, confidence: proposal.confidence })}
            </span>
            <span className="flex-1" />
            <select
              data-testid={`registry-proposal-area-${proposal.id}`}
              defaultValue=""
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                if (event.target.value.length > 0) {
                  void handleAcceptProposal(proposal, event.target.value);
                }
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("registry.selectArea")}</option>
              {activeAreas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.number}-{area.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              data-testid={`registry-proposal-ignore-${proposal.id}`}
              onClick={() => handleIgnoreProposal(proposal.id)}
            >
              {t("registry.proposalIgnore")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};
