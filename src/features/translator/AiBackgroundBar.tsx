import { Icon } from "../../components/Icon";
import { formatDuration } from "../../lib/duration";
import { useTranslation } from "../../lib/i18n";
import { type AiJob, useAiJobs } from "./aiJobs";

function stateLabel(job: AiJob): string {
  if (job.state === "done") return "Ready to review";
  if (job.state === "failed") return "Failed";
  if (job.state === "paused") return "Paused";
  if (job.state === "cancelled") return "Cancelled";
  return "Translating";
}

/**
 * Persistent strip for AI runs that continue while the user works elsewhere.
 * Every run shows its chapter, mode, elapsed time and a way to cancel it, so
 * background work is never invisible.
 */
export function AiBackgroundBar({
  onOpenChapter,
}: {
  onOpenChapter: (chapterId: string) => void;
}) {
  const { t } = useTranslation();
  const { jobs, cancelJob, dismissJob } = useAiJobs();
  // Finished proposals that already reached the draft need no attention.
  const visible = jobs.filter(
    (job) => !job.foreground && !(job.state === "done" && job.inserted),
  );
  if (!visible.length) return null;
  return (
    <section className="ai-background" aria-label={t("AI translation in the background")}>
      {visible.map((job) => {
        const running = job.state === "running";
        return (
          <div
            className={`ai-background__job ai-background__job--${job.state}`}
            key={job.jobId}
          >
            <span className="ai-background__icon">
              <Icon name="sparkles" spin={running} />
            </span>
            <span className="ai-background__text" role="status" aria-live="polite">
              <strong>{job.chapterTitle || t("Chapter")}</strong>
              <span className="ai-background__meta">
                {t(stateLabel(job))} · {job.mode}
                {running ? ` · ${formatDuration(job.elapsedSecs)}` : ""}
              </span>
              {job.message && job.state !== "running" ? (
                <span className="ai-background__message">{job.message}</span>
              ) : null}
            </span>
            {job.state === "done" || job.state === "failed" || job.state === "paused" ? (
              <button
                type="button"
                className="btn btn--small"
                onClick={() => onOpenChapter(job.chapterId)}
              >
                <Icon name="book" />
                {t("Open")}
              </button>
            ) : null}
            {running ? (
              <button
                type="button"
                className="icon-button"
                aria-label={t("Cancel translation")}
                title={t("Cancel translation")}
                onClick={() => cancelJob(job.jobId)}
              >
                <Icon name="close" />
              </button>
            ) : (
              <button
                type="button"
                className="icon-button"
                aria-label={t("Dismiss")}
                title={t("Dismiss")}
                onClick={() => dismissJob(job.jobId)}
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
