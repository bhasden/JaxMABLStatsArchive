import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendQueryHistory,
  hashBytes,
  isLikelyMutatingSql,
  loadQueryHistory,
  loadWorkingDb,
  resetWorkingDb,
  saveWorkingDb,
  type QueryHistoryEntry,
  type QueryResult,
} from "../data/archiveDb";
import { ArchiveDbClient } from "../data/archiveWorker";

export type RunQueryOptions = {
  source: QueryHistoryEntry["source"];
  label?: string;
  remember?: boolean;
  forceModified?: boolean;
};

export function useArchiveDatabase() {
  const clientRef = useRef<ArchiveDbClient | null>(null);
  const pristineBytesRef = useRef<Uint8Array | null>(null);
  const pristineHashRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Loading archive database");
  const [error, setError] = useState<string | null>(null);
  const [modified, setModified] = useState(false);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const client = new ArchiveDbClient();
    clientRef.current = client;

    async function load() {
      try {
        setLoadingMessage("Fetching published archive database");
        const response = await fetch(`${import.meta.env.BASE_URL}archive.sqlite`, { cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`archive.sqlite could not be loaded (${response.status})`);
        }

        const pristineBytes = new Uint8Array(await response.arrayBuffer());
        const pristineHash = await hashBytes(pristineBytes);
        pristineBytesRef.current = pristineBytes;
        pristineHashRef.current = pristineHash;

        const saved = await loadWorkingDb();
        const shouldUseSaved = saved?.modified || saved?.sourceHash === pristineHash;
        const workingBytes = shouldUseSaved ? saved.bytes : pristineBytes;
        await client.load(new Uint8Array(workingBytes));

        if (!shouldUseSaved) {
          await resetWorkingDb(pristineBytes, pristineHash);
        }

        const savedHistory = await loadQueryHistory();
        if (!cancelled) {
          setHistory(savedHistory);
          setModified(shouldUseSaved ? (saved?.modified ?? false) : false);
          setReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      client.close();
    };
  }, []);

  const runQuery = useCallback(async (sql: string, options: RunQueryOptions): Promise<QueryResult[]> => {
    if (!clientRef.current) {
      throw new Error("Archive database is not ready.");
    }

    const results = await clientRef.current.exec(sql);
    const rowCount = results.reduce((total, result) => total + result.values.length, 0);
    const shouldMarkModified = options.forceModified || isLikelyMutatingSql(sql);

    if (shouldMarkModified) {
      const bytes = await clientRef.current.exportDb();
      await saveWorkingDb({
        bytes,
        modified: true,
        savedAt: new Date().toISOString(),
        sourceHash: pristineHashRef.current ?? undefined,
      });
      setModified(true);
    }

    if (options.remember ?? true) {
      const entry = await appendQueryHistory({
        sql,
        source: options.source,
        label: options.label,
        rowCount,
      });
      setHistory((current) => [entry, ...current].slice(0, 50));
    }

    return results;
  }, []);

  const reset = useCallback(async () => {
    if (!clientRef.current || !pristineBytesRef.current) {
      return;
    }
    const bytes = new Uint8Array(pristineBytesRef.current);
    await clientRef.current.load(bytes);
    await resetWorkingDb(bytes, pristineHashRef.current ?? undefined);
    setModified(false);
  }, []);

  const exportWorkingDb = useCallback(async () => {
    if (!clientRef.current) {
      throw new Error("Archive database is not ready.");
    }
    return clientRef.current.exportDb();
  }, []);

  return useMemo(
    () => ({
      ready,
      loadingMessage,
      error,
      modified,
      history,
      runQuery,
      reset,
      exportWorkingDb,
    }),
    [ready, loadingMessage, error, modified, history, runQuery, reset, exportWorkingDb],
  );
}
