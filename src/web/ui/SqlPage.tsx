import { useState } from "react";
import { downloadBytes, downloadBytes as downloadResultBytes } from "../data/archiveDb";
import type { QueryResult } from "../data/archiveDb";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { SQL_EXPLORER_DRAFT_KEY, SQL_EXPLORER_DRAFT_PARAM, Table, type ArchiveContext } from "./queryHelpers";

const STARTER_SQL = `SELECT *
FROM v_season_summary
ORDER BY season_id DESC;`;

function csvEscape(value: unknown) {
  if (value == null) {
    return "";
  }
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function resultToCsv(result: QueryResult) {
  return [result.columns.map(csvEscape).join(","), ...result.values.map((row) => row.map(csvEscape).join(","))].join(
    "\n",
  );
}

function readSqlExplorerDraft() {
  const [, hashSearch = ""] = window.location.hash.split("?");
  const draftId = new URLSearchParams(hashSearch).get(SQL_EXPLORER_DRAFT_PARAM);

  if (draftId) {
    const draftKey = `${SQL_EXPLORER_DRAFT_KEY}:${draftId}`;
    const draft = window.localStorage.getItem(draftKey);
    window.localStorage.removeItem(draftKey);
    if (draft) {
      return draft;
    }
  }

  const draft =
    window.sessionStorage.getItem(SQL_EXPLORER_DRAFT_KEY) ?? window.localStorage.getItem(SQL_EXPLORER_DRAFT_KEY);
  if (draft) {
    window.sessionStorage.removeItem(SQL_EXPLORER_DRAFT_KEY);
    window.localStorage.removeItem(SQL_EXPLORER_DRAFT_KEY);
    return draft;
  }

  return STARTER_SQL;
}

export function SqlPage({
  archive,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const [sql, setSql] = useState(readSqlExplorerDraft);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run(forceModified = false) {
    setError(null);
    try {
      const next = await archive.runQuery(sql, {
        source: "explorer",
        label: "SQL explorer",
        forceModified,
      });
      setResults(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function downloadDb() {
    const bytes = await archive.exportWorkingDb();
    downloadBytes(bytes, "jax-mabl-archive-working.sqlite");
  }

  function exportCsv() {
    if (!results[0]) {
      return;
    }
    const bytes = new TextEncoder().encode(resultToCsv(results[0]));
    downloadResultBytes(bytes, "query-results.csv", "text/csv");
  }

  return (
    <div className="page-grid sql-page">
      <section className="section-head">
        <p className="eyebrow">Research workbench</p>
        <h1>SQL Explorer</h1>
      </section>
      <section className="sql-workspace">
        <textarea value={sql} onChange={(event) => setSql(event.target.value)} spellCheck={false} />
        <div className="toolbar">
          <button type="button" onClick={() => run(false)}>
            Run SQL
          </button>
          <button type="button" onClick={() => run(true)}>
            Run and Mark Modified
          </button>
          <button type="button" onClick={exportCsv}>
            Export CSV
          </button>
          <button type="button" onClick={downloadDb}>
            Download DB
          </button>
          <button type="button" onClick={archive.reset}>
            Reset DB
          </button>
        </div>
        {error ? <div className="notice error">{error}</div> : null}
      </section>
      {results.map((result, index) => (
        <section key={index}>
          <h2>Result {index + 1}</h2>
          <Table result={result} columnHeaderMode={columnHeaderMode} query={sql} />
        </section>
      ))}
      <section>
        <h2>Recent Queries</h2>
        <div className="history-list">
          {archive.history.map((entry) => (
            <button key={entry.id} type="button" onClick={() => setSql(entry.sql)}>
              <strong>{entry.label ?? entry.source}</strong>
              <span>{new Date(entry.ranAt).toLocaleString()}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
