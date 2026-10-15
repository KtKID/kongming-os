/** 当前会话内的 CLI 记录视图：查询失败保留内容，原文以文本显示。 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConvViewProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import { Button, Toast } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  SnapshotSchema,
  TimelineSchema,
  DetailSchema,
  type TraceSnapshot,
  type TraceEntry,
  type TraceDetail,
  type TimelineRequest,
  type TimelinePage,
} from "../protocol.ts";
import {
  DEFAULT_REFRESH_INTERVAL_MS,
  TRACE_BASE,
  TIMELINE_PAGE_SIZE,
} from "../paths.ts";
import {
  chooseTurn,
  fetchJson,
  notices,
  poll,
  receiveExport,
} from "./state.ts";
import { styles as S } from "./styles.ts";
import type { LocaleKey } from "./locales.ts";
type Props = ConvViewProps & PropsLocale<"codex-cli-trace">;
const categories = [
  "all",
  "message",
  "response",
  "tool",
  "skill",
  "file",
  "reasoning",
  "unknown",
] satisfies TimelineRequest["category"][];
function number(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}
function seconds(value: number | null): string {
  return value === null ? "—" : (value / 1000).toFixed(3) + " s";
}
/** 全局提示拥有者比当前标签活得更久。 */
export function TraceToast(): JSX.Element | null {
  const value = useSyncExternalStore(
    notices.subscribe,
    notices.getSnapshot,
    notices.getSnapshot,
  );
  return value === null ? null : (
    <Toast key={value.id} text={value.text} onDone={notices.clear} />
  );
}
/** 槽位提供 sessionId，所有网络结果受当前 effect 的取消信号保护。 */
export function TraceView({ sessionId, t }: Props): JSX.Element {
  const [storedSnapshot, setSnapshot] = useState<TraceSnapshot | null>(null),
    [nativeTurnId, setTurn] = useState<string | null>(null),
    [rows, setRows] = useState<TraceEntry[]>([]),
    [total, setTotal] = useState(0),
    [entryId, setEntry] = useState<string | null>(null),
    [detail, setDetail] = useState<TraceDetail | null>(null);
  const snapshot =
    storedSnapshot?.sessionId === sessionId ? storedSnapshot : null;
  const [exporting, setExporting] = useState(false);
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      exportAbort.current?.abort();
      setExporting(false);
    },
    [sessionId],
  );
  const [newRecords, setNewRecords] = useState(false);
  const stamp = useRef<{ sessionId: string; end: number } | null>(null);
  const interval = useRef(DEFAULT_REFRESH_INTERVAL_MS);
  const jump = useRef(false);
  const [category, setCategory] = useState<TimelineRequest["category"]>("all"),
    [q, setQ] = useState(""),
    [onlyErrors, setErrors] = useState(false),
    [desired, setDesired] = useState(TIMELINE_PAGE_SIZE),
    [timelineVersion, bumpTimeline] = useState(0),
    [reload, setReload] = useState(0),
    [detailRetry, setDetailRetry] = useState(0);
  const [failure, setFailure] = useState<string | null>(null),
    [queryFailure, setQueryFailure] = useState<string | null>(null),
    [detailFailure, setDetailFailure] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [queryBusy, setQueryBusy] = useState(false),
    [detailBusy, setDetailBusy] = useState(false);
  const [narrow, setNarrow] = useState(
      () => window.matchMedia("(max-width: 760px)").matches,
    ),
    [showDetail, setShowDetail] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const change = (): void => {
      setNarrow(media.matches);
    };
    media.addEventListener("change", change);
    return () => {
      media.removeEventListener("change", change);
    };
  }, []);
  const scroll = useRef<HTMLDivElement | null>(null);
  const force = useRef(false);
  const lastSession = useRef(sessionId);
  useEffect(() => {
    if (lastSession.current !== sessionId) {
      lastSession.current = sessionId;
      setShowDetail(false);
      setSnapshot(null);
      setRows([]);
      setDetail(null);
      setEntry(null);
      setTurn(null);
      setQ("");
      setErrors(false);
      setCategory("all");
      setDesired(TIMELINE_PAGE_SIZE);
      setNewRecords(false);
      stamp.current = null;
    }
    setFailure(null);
    setBusy(true);
    const worker = poll({
      interval: () => interval.current,
      visible: () => document.visibilityState !== "hidden",
      onError: (error) => {
        setFailure(error instanceof Error ? error.message : t("dataFailure"));
        setBusy(false);
      },
      run: async (signal) => {
        const params = new URLSearchParams({
          sessionId,
          ...(force.current ? { reload: "1" } : {}),
        });
        force.current = false;
        const value = await fetchJson(
          TRACE_BASE + "/snapshot?" + params.toString(),
          SnapshotSchema,
          signal,
        );
        if (signal.aborted) return;
        const end = value.source?.completeByteEnd ?? 0;
        if (stamp.current?.sessionId === sessionId && end > stamp.current.end)
          setNewRecords(true);
        stamp.current = { sessionId, end };
        interval.current = value.refreshIntervalMs;
        setSnapshot(value);
        setTurn((previous) => chooseTurn(value.turns, previous));
        setFailure(null);
        setBusy(false);
      },
    });
    const wake = (): void => {
      worker.wake();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      worker.stop();
      document.removeEventListener("visibilitychange", wake);
    };
  }, [sessionId, reload, t]);
  const token = snapshot?.readToken ?? null;
  useEffect(() => {
    if (token === null || nativeTurnId === null) return;
    const abort = new AbortController();
    setQueryFailure(null);
    setQueryBusy(true);
    const run = async (): Promise<void> => {
      const entries: TraceEntry[] = [];
      let cursor: number | null = 0;
      let resultTotal = 0;
      while (cursor !== null && entries.length < desired) {
        const params: URLSearchParams = new URLSearchParams({
          sessionId,
          readToken: token,
          nativeTurnId,
          category,
          q,
          onlyErrors: onlyErrors ? "1" : "0",
          cursor: String(cursor),
          limit: String(TIMELINE_PAGE_SIZE),
        });
        const page: TimelinePage = await fetchJson(
          TRACE_BASE + "/timeline?" + params.toString(),
          TimelineSchema,
          abort.signal,
        );
        entries.push(...page.entries);
        cursor = page.nextCursor;
        resultTotal = page.total;
      }
      if (abort.signal.aborted) return;
      setRows(entries);
      setTotal(resultTotal);
      const jumping = jump.current;
      setEntry((previous) =>
        jumping
          ? (entries.at(-1)?.entryId ?? null)
          : entries.some((e) => e.entryId === previous)
            ? previous
            : (entries[0]?.entryId ?? null),
      );
      if (jump.current) {
        jump.current = false;
        requestAnimationFrame(() => {
          scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
        });
      }
    };
    run()
      .catch((error) => {
        if (!abort.signal.aborted)
          setQueryFailure(
            error instanceof Error ? error.message : t("dataFailure"),
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setQueryBusy(false);
      })
      .catch(() => {});
    return () => {
      abort.abort();
    };
  }, [
    sessionId,
    token,
    nativeTurnId,
    category,
    q,
    onlyErrors,
    desired,
    timelineVersion,
    t,
  ]);
  useEffect(() => {
    if (token === null || entryId === null) {
      setDetail(null);
      setDetailBusy(false);
      setDetailFailure(null);
      return;
    }
    const abort = new AbortController();
    setDetailFailure(null);
    setDetailBusy(true);
    setDetail((previous) =>
      previous?.entry.entryId === entryId ? previous : null,
    );
    const params: URLSearchParams = new URLSearchParams({
      sessionId,
      readToken: token,
      entryId,
    });
    fetchJson(
      TRACE_BASE + "/entry?" + params.toString(),
      DetailSchema,
      abort.signal,
    )
      .then(
        (value) => {
          if (!abort.signal.aborted) setDetail(value);
        },
        (error) => {
          if (!abort.signal.aborted)
            setDetailFailure(
              error instanceof Error ? error.message : t("detailFailure"),
            );
        },
      )
      .finally(() => {
        if (!abort.signal.aborted) setDetailBusy(false);
      })
      .catch(() => {});
    return () => {
      abort.abort();
    };
  }, [sessionId, token, entryId, detailRetry, t]);
  const save = (): void => {
    if (exporting) return;
    const abort = new AbortController();
    exportAbort.current = abort;
    setExporting(true);
    receiveExport(sessionId, abort.signal)
      .then(
        ({ blob, name }) => {
          if (abort.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          try {
            link.href = url;
            link.download = name;
            link.click();
            notices.show(t("ready"));
          } finally {
            URL.revokeObjectURL(url);
          }
        },
        (error) => {
          if (!abort.signal.aborted)
            notices.show(
              error instanceof Error ? error.message : t("dataFailure"),
            );
        },
      )
      .finally(() => {
        if (exportAbort.current === abort) {
          exportAbort.current = null;
          setExporting(false);
        }
      })
      .catch(() => {});
  };
  const selected =
    snapshot?.turns.find((turn) => turn.nativeTurnId === nativeTurnId) ?? null;
  const retry = (): void => {
    force.current = true;
    setReload((x) => x + 1);
  };
  const latest = (): void => {
    setNewRecords(false);
    setTurn(snapshot?.turns.at(-1)?.nativeTurnId ?? null);
    setDetail(null);
    setEntry(null);
    setQ("");
    setCategory("all");
    setErrors(false);
    setDesired(Number.MAX_SAFE_INTEGER);
    jump.current = true;
    bumpTimeline((x) => x + 1);
    setDetailRetry((x) => x + 1);
  };
  const status = (value: TraceEntry["status"]): string =>
    t(value === "unknown" ? "statusUnknown" : value);
  const copy = (text: string): void => {
    navigator.clipboard.writeText(text).then(
      () => {
        notices.show(t("copied"));
      },
      () => {
        notices.show(t("copyFailed"));
      },
    );
  };
  const block = (label: LocaleKey, value: string | null): JSX.Element => (
    <section>
      <div style={S.bar}>
        <span style={{ fontWeight: 500 }}>{t(label)}</span>
        {value !== null && (
          <Button
            size="sm"
            onClick={() => {
              copy(value);
            }}
          >
            {t("copy")}
          </Button>
        )}
      </div>
      <pre style={S.pre}>
        {value === null
          ? t(label === "result" ? "noresult" : "unrecorded")
          : value === ""
            ? '""'
            : value}
      </pre>
    </section>
  );
  return (
    <div data-codex-cli-trace="" style={S.root}>
      <div style={S.bar}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{t("title")}</span>
        <span style={S.muted}>{snapshot?.nativeSessionId ?? sessionId}</span>
        <Button size="sm" variant="outline" onClick={retry}>
          {t("reload")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={snapshot?.state !== "ready" || exporting}
          onClick={save}
        >
          {t(exporting ? "exporting" : "export")}
        </Button>
      </div>
      {failure !== null && (
        <div role="alert" style={S.error}>
          {failure}
        </div>
      )}
      {snapshot === null && busy && <div style={S.muted}>{t("loading")}</div>}
      {snapshot !== null && snapshot.state !== "ready" && (
        <div style={S.muted}>
          {t(snapshot.state === "unlinked" ? "empty" : "waiting")}
        </div>
      )}
      {snapshot?.state === "ready" && (
        <>
          <div style={S.bar}>
            <label style={{ minWidth: 0, maxWidth: "100%" }}>
              {t("turn")}{" "}
              <select
                aria-label={t("turn")}
                style={{ ...S.input, maxWidth: "100%" }}
                value={nativeTurnId ?? ""}
                onChange={(event) => {
                  setTurn(event.currentTarget.value);
                  setDetail(null);
                  setEntry(null);
                  setTotal(0);
                  setDesired(TIMELINE_PAGE_SIZE);
                  setRows([]);
                }}
              >
                {snapshot.turns.map((turn) => (
                  <option key={turn.nativeTurnId} value={turn.nativeTurnId}>
                    {turn.title.slice(0, 70)}
                  </option>
                ))}
              </select>
            </label>
            <span style={S.muted}>
              {selected?.model ?? t("unrecorded")} ·{" "}
              {selected?.effort ?? t("unrecorded")} ·{" "}
              {selected === null ? "" : status(selected.status)}
            </span>
          </div>
          {selected !== null && (
            <div style={S.stats}>
              {(
                [
                  ["total", number(selected.usage.total)],
                  ["cached", number(selected.usage.cached)],
                  ["cacheWrite", number(selected.usage.cacheWrite)],
                  ["reasoningTokens", number(selected.usage.reasoning)],
                  ["input", number(selected.usage.input)],
                  ["output", number(selected.usage.output)],
                  ["responses", number(selected.responseCount)],
                  ["calls", number(selected.toolCount)],
                  [
                    "cache",
                    selected.usage.input !== null &&
                    selected.usage.input > 0 &&
                    selected.usage.cached !== null
                      ? (
                          (selected.usage.cached / selected.usage.input) *
                          100
                        ).toFixed(1) + "%"
                      : "—",
                  ],
                  ["duration", seconds(selected.durationMs)],
                  ["ttft", seconds(selected.ttftMs)],
                ] satisfies [LocaleKey, string][]
              ).map(([label, value]) => (
                <div key={label}>
                  <div style={S.muted}>{t(label)}</div>
                  <div style={{ fontSize: 17, fontWeight: 500, marginTop: 4 }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          )}
          {newRecords && (
            <div style={S.bar} role="status">
              {t("newRecords")}
              <Button size="sm" onClick={latest}>
                {t("latest")}
              </Button>
            </div>
          )}
          <div style={S.bar}>
            <select
              aria-label={t("all")}
              style={S.input}
              value={category}
              onChange={(event) => {
                const value = categories.find(
                  (c) => c === event.currentTarget.value,
                );
                if (value !== undefined) setCategory(value);
                setDesired(TIMELINE_PAGE_SIZE);
              }}
            >
              {categories.map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
            <input
              style={{ ...S.input, flex: "1 1 180px" }}
              aria-label={t("search")}
              placeholder={t("search")}
              value={q}
              onChange={(event) => {
                setQ(event.currentTarget.value);
                setDesired(TIMELINE_PAGE_SIZE);
              }}
            />
            <label>
              <input
                type="checkbox"
                checked={onlyErrors}
                onChange={(event) => {
                  setErrors(event.currentTarget.checked);
                  setDesired(TIMELINE_PAGE_SIZE);
                }}
              />{" "}
              {t("errors")}
            </label>
            {(q !== "" || onlyErrors || category !== "all") && (
              <Button
                size="sm"
                onClick={() => {
                  setQ("");
                  setErrors(false);
                  setCategory("all");
                  setDesired(TIMELINE_PAGE_SIZE);
                }}
              >
                {t("clear")}
              </Button>
            )}
            <span style={S.muted} aria-live="polite">
              {queryBusy ? t("loading") : rows.length + "/" + total}
            </span>
          </div>
          {queryFailure !== null && (
            <div role="alert" style={S.error}>
              {queryFailure}
            </div>
          )}
          <div style={S.body}>
            <div
              ref={scroll}
              style={{
                ...S.list,
                ...(narrow && showDetail ? { display: "none" } : {}),
              }}
              aria-busy={queryBusy}
              data-trace-timeline=""
            >
              {rows.length === 0 && !queryBusy && (
                <div style={S.muted}>{t("nomatch")}</div>
              )}
              {rows.map((entry) => (
                <button
                  type="button"
                  key={entry.entryId}
                  style={{
                    ...S.row,
                    ...(entry.entryId === entryId
                      ? { background: "var(--dsw-alias-bg-layer-1)" }
                      : {}),
                  }}
                  aria-pressed={entry.entryId === entryId}
                  onClick={() => {
                    setEntry(entry.entryId);
                    setShowDetail(true);
                  }}
                >
                  <div style={S.bar}>
                    <span style={S.muted}>{t(entry.kind)}</span>
                    <span>{entry.title}</span>
                  </div>
                  <div style={S.muted}>
                    {status(entry.status)} · {entry.at ?? t("unrecorded")} ·{" "}
                    {seconds(entry.durationMs)}
                  </div>
                </button>
              ))}
              {rows.length < total && (
                <Button
                  size="sm"
                  onClick={() => {
                    setDesired((value) => value + TIMELINE_PAGE_SIZE);
                  }}
                >
                  {t("more")}
                </Button>
              )}
            </div>
            <div
              style={{
                ...S.detail,
                ...(narrow && !showDetail ? { display: "none" } : {}),
              }}
              data-trace-detail=""
              aria-busy={detailBusy}
            >
              {narrow && (
                <Button
                  size="sm"
                  onClick={() => {
                    setShowDetail(false);
                  }}
                >
                  {t("back")}
                </Button>
              )}
              {detailFailure !== null && (
                <div role="alert" style={S.error}>
                  {detailFailure}
                  <Button
                    size="sm"
                    onClick={() => {
                      setDetailRetry((x) => x + 1);
                    }}
                  >
                    {t("reload")}
                  </Button>
                </div>
              )}
              {detail === null ? (
                <div style={S.muted}>{t("select")}</div>
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {detail.entry.title}
                  </div>
                  <div style={{ ...S.muted, margin: "8px 0" }}>
                    {status(detail.entry.status)} ·{" "}
                    {seconds(detail.entry.durationMs)} · {detail.entry.entryId}
                  </div>
                  {detail.entry.usage !== null &&
                    block("total", JSON.stringify(detail.entry.usage, null, 2))}
                  {detail.entry.callId !== null && (
                    <>
                      {block("args", detail.arguments)}
                      {block("result", detail.result)}
                    </>
                  )}
                  {detail.text !== null && block("text", detail.text)}
                  <details>
                    <summary>
                      {t("raw")} ({detail.raw.length})
                    </summary>
                    {detail.raw.map((raw) => (
                      <section key={raw.source.line}>
                        <div style={S.muted}>
                          {snapshot.source?.path} : {raw.source.line} · [
                          {raw.source.byteStart},{raw.source.byteEnd})
                        </div>
                        <Button
                          size="sm"
                          onClick={() => {
                            copy(raw.text);
                          }}
                        >
                          {t("copy")}
                        </Button>
                        <pre style={S.pre}>{raw.text}</pre>
                      </section>
                    ))}
                  </details>
                </>
              )}
            </div>
          </div>
          <details>
            <summary style={S.muted}>
              {t("coverage")} · {snapshot.issues.length}
            </summary>
            <div style={S.muted}>
              {snapshot.issues.length === 0
                ? "当前已读记录可正常识别"
                : snapshot.issues.map((issue, index) => (
                    <div key={index}>
                      {issue.kind} · {issue.message}
                      {issue.source === null ? "" : " · " + issue.source.line}
                    </div>
                  ))}
            </div>
          </details>
          <div style={S.muted}>
            {t("source")}: {snapshot.source?.path} · {t("readAt")}:{" "}
            {snapshot.readAt} · CLI{" "}
            {snapshot.source?.cliVersion ?? t("unrecorded")}
          </div>
        </>
      )}
    </div>
  );
}
