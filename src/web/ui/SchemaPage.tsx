import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { QueryResult } from "../data/archiveDb";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { href } from "../hooks/useHashRoute";
import { SQL_EXPLORER_DRAFT_KEY, SQL_EXPLORER_DRAFT_PARAM, type ArchiveContext, usePageQuery } from "./queryHelpers";

const OBJECTS_SQL = `
SELECT
  type,
  name,
  sql
FROM sqlite_schema
WHERE type IN ('table', 'view')
  AND name NOT LIKE 'sqlite_%'
ORDER BY type, name;
`;

type SchemaObject = {
  type: "table" | "view";
  name: string;
  sql: string | null;
};

type ColumnMetadata = {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  defaultValue: string | null;
  primaryKeyPosition: number;
};

type ForeignKeyMetadata = {
  id: number;
  sequence: number;
  referencesTable: string;
  fromColumn: string;
  toColumn: string | null;
  onUpdate: string;
  onDelete: string;
};

type IndexMetadata = {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
};

type ObjectMetadata = {
  columns: ColumnMetadata[];
  foreignKeys: ForeignKeyMetadata[];
  indexes: IndexMetadata[];
};

type MetadataState = {
  loading: boolean;
  error: string | null;
  value: ObjectMetadata | null;
};

export function SchemaPage({ archive }: { archive: ArchiveContext; columnHeaderMode: ColumnHeaderMode }) {
  const objectsQuery = usePageQuery(archive, OBJECTS_SQL, "Schema objects");
  const objects = useMemo(() => schemaObjectsFromResult(objectsQuery.result), [objectsQuery.result]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | SchemaObject["type"]>("all");
  const [selectedObjectName, setSelectedObjectName] = useState<string | null>(null);

  const filteredObjects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return objects.filter((object) => {
      const matchesType = typeFilter === "all" || object.type === typeFilter;
      const matchesSearch =
        !normalizedSearch ||
        object.name.toLowerCase().includes(normalizedSearch) ||
        object.type.toLowerCase().includes(normalizedSearch);
      return matchesType && matchesSearch;
    });
  }, [objects, search, typeFilter]);

  useEffect(() => {
    if (filteredObjects.length === 0) {
      setSelectedObjectName(null);
      return;
    }
    const selectionStillVisible = filteredObjects.some((object) => object.name === selectedObjectName);
    if (!selectionStillVisible) {
      setSelectedObjectName(filteredObjects[0].name);
    }
  }, [filteredObjects, selectedObjectName]);

  const selectedObject =
    filteredObjects.find((object) => object.name === selectedObjectName) ??
    objects.find((object) => object.name === selectedObjectName) ??
    null;
  const metadata = useObjectMetadata(archive, selectedObject);
  const starterQuery = selectedObject ? buildStarterQuery(selectedObject.name) : "";

  return (
    <div className="page-grid">
      <section className="section-head">
        <p className="eyebrow">Data portal</p>
        <h1>Schema Explorer</h1>
      </section>

      {objectsQuery.error ? <div className="notice error">{objectsQuery.error}</div> : null}

      <section className="schema-explorer">
        <aside className="schema-browser" aria-label="Schema objects">
          <label className="schema-search">
            <span>Find a table or view</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search schema objects"
            />
          </label>

          <div className="segmented-control schema-filter" role="tablist" aria-label="Schema object type">
            {(["all", "table", "view"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                role="tab"
                aria-selected={typeFilter === filter}
                className={typeFilter === filter ? "active" : ""}
                onClick={() => setTypeFilter(filter)}
              >
                {filter === "all" ? "All" : `${filter.charAt(0).toUpperCase()}${filter.slice(1)}s`}
              </button>
            ))}
          </div>

          <div className="schema-object-list">
            {!objectsQuery.result ? <div className="muted">Loading schema objects</div> : null}
            {objectsQuery.result && filteredObjects.length === 0 ? (
              <div className="muted">No matching tables or views.</div>
            ) : null}
            {filteredObjects.map((object) => (
              <button
                key={`${object.type}:${object.name}`}
                type="button"
                className={object.name === selectedObject?.name ? "schema-object active" : "schema-object"}
                onClick={() => setSelectedObjectName(object.name)}
              >
                <span>{object.name}</span>
                <small>{object.type}</small>
              </button>
            ))}
          </div>
        </aside>

        <div className="schema-detail">
          {!selectedObject ? (
            <div className="notice">Select a table or view to inspect its metadata.</div>
          ) : (
            <>
              <div className="schema-detail-head">
                <div>
                  <p className="eyebrow">{selectedObject.type}</p>
                  <h2>{selectedObject.name}</h2>
                </div>
                <div className="schema-object-actions">
                  <button type="button" onClick={() => openStarterQuery(starterQuery)}>
                    Open in SQL Explorer
                  </button>
                  <button type="button" onClick={() => copyText(selectedObject.name)}>
                    Copy Object Name
                  </button>
                  <button type="button" onClick={() => copyText(starterQuery)}>
                    Copy Starter Query
                  </button>
                </div>
              </div>

              {metadata.error ? <div className="notice error">{metadata.error}</div> : null}
              {metadata.loading ? <div className="muted">Loading object metadata</div> : null}

              {metadata.value ? (
                <>
                  <MetadataSection title="Columns">
                    <MetadataTable
                      columns={["Column", "Type", "Required", "Primary Key", "Default"]}
                      rows={metadata.value.columns.map((column) => [
                        column.name,
                        column.type || "",
                        column.notnull ? "Yes" : "",
                        column.primaryKeyPosition > 0 ? String(column.primaryKeyPosition) : "",
                        column.defaultValue ?? "",
                      ])}
                      emptyMessage="No columns found."
                    />
                  </MetadataSection>

                  <MetadataSection title="Relationships">
                    <MetadataTable
                      columns={["Column", "References", "Target Column", "On Update", "On Delete"]}
                      rows={metadata.value.foreignKeys.map((foreignKey) => [
                        foreignKey.fromColumn,
                        foreignKey.referencesTable,
                        foreignKey.toColumn ?? "",
                        foreignKey.onUpdate,
                        foreignKey.onDelete,
                      ])}
                      emptyMessage="No foreign keys declared."
                    />
                  </MetadataSection>

                  <details className="schema-secondary">
                    <summary>Indexes</summary>
                    <MetadataTable
                      columns={["Index", "Unique", "Origin", "Partial", "Columns"]}
                      rows={metadata.value.indexes.map((index) => [
                        index.name,
                        index.unique ? "Yes" : "",
                        index.origin,
                        index.partial ? "Yes" : "",
                        index.columns.join(", "),
                      ])}
                      emptyMessage="No indexes declared."
                    />
                  </details>

                  <details className="schema-secondary">
                    <summary>Definition SQL</summary>
                    <pre className="schema-sql">{selectedObject.sql ?? "Definition SQL is unavailable."}</pre>
                  </details>
                </>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function MetadataSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="schema-metadata-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function MetadataTable({ columns, rows, emptyMessage }: { columns: string[]; rows: string[][]; emptyMessage: string }) {
  if (rows.length === 0) {
    return <div className="muted schema-empty">{emptyMessage}</div>;
  }

  return (
    <div className="table-wrap schema-table-wrap">
      <table className="schema-metadata-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, cellIndex) => (
                <td key={`${rowIndex}:${cellIndex}`}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useObjectMetadata(archive: ArchiveContext, selectedObject: SchemaObject | null): MetadataState {
  const [metadata, setMetadata] = useState<MetadataState>({
    loading: false,
    error: null,
    value: null,
  });
  const { runQuery } = archive;

  useEffect(() => {
    let cancelled = false;
    if (!selectedObject) {
      setMetadata({ loading: false, error: null, value: null });
      return;
    }
    const object = selectedObject;

    async function load() {
      setMetadata({ loading: true, error: null, value: null });
      try {
        const identifier = pragmaIdentifier(object.name);
        const [columnsResult, foreignKeysResult, indexesResult] = await Promise.all([
          runMetadataQuery(runQuery, `PRAGMA table_info(${identifier});`, `${object.name} columns`),
          runMetadataQuery(runQuery, `PRAGMA foreign_key_list(${identifier});`, `${object.name} foreign keys`),
          runMetadataQuery(runQuery, `PRAGMA index_list(${identifier});`, `${object.name} indexes`),
        ]);

        const indexList = indexesFromResult(indexesResult);
        const indexes = await Promise.all(
          indexList.map(async (index) => ({
            ...index,
            columns: indexColumnsFromResult(
              await runMetadataQuery(
                runQuery,
                `PRAGMA index_info(${pragmaIdentifier(index.name)});`,
                `${index.name} index columns`,
              ),
            ),
          })),
        );

        if (!cancelled) {
          setMetadata({
            loading: false,
            error: null,
            value: {
              columns: columnsFromResult(columnsResult),
              foreignKeys: foreignKeysFromResult(foreignKeysResult),
              indexes,
            },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setMetadata({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            value: null,
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [runQuery, selectedObject]);

  return metadata;
}

type RunQuery = ArchiveContext["runQuery"];

async function runMetadataQuery(runQuery: RunQuery, sql: string, label: string) {
  const results = await runQuery(sql, { source: "page", label, remember: false });
  return results[0] ?? { columns: [], values: [] };
}

function schemaObjectsFromResult(result: QueryResult | null) {
  if (!result) {
    return [] as SchemaObject[];
  }

  const typeIndex = result.columns.indexOf("type");
  const nameIndex = result.columns.indexOf("name");
  const sqlIndex = result.columns.indexOf("sql");
  return result.values
    .map((row) => {
      const type = String(row[typeIndex] ?? "");
      const name = String(row[nameIndex] ?? "");
      if ((type !== "table" && type !== "view") || !name) {
        return null;
      }
      return {
        type,
        name,
        sql: row[sqlIndex] == null ? null : String(row[sqlIndex]),
      } satisfies SchemaObject;
    })
    .filter((object): object is SchemaObject => !!object);
}

function columnsFromResult(result: QueryResult) {
  return result.values.map((row) => ({
    cid: numberValue(result, row, "cid"),
    name: stringValue(result, row, "name"),
    type: stringValue(result, row, "type"),
    notnull: booleanValue(result, row, "notnull"),
    defaultValue: nullableStringValue(result, row, "dflt_value"),
    primaryKeyPosition: numberValue(result, row, "pk"),
  }));
}

function foreignKeysFromResult(result: QueryResult) {
  return result.values.map((row) => ({
    id: numberValue(result, row, "id"),
    sequence: numberValue(result, row, "seq"),
    referencesTable: stringValue(result, row, "table"),
    fromColumn: stringValue(result, row, "from"),
    toColumn: nullableStringValue(result, row, "to"),
    onUpdate: stringValue(result, row, "on_update"),
    onDelete: stringValue(result, row, "on_delete"),
  }));
}

function indexesFromResult(result: QueryResult) {
  return result.values.map((row) => ({
    name: stringValue(result, row, "name"),
    unique: booleanValue(result, row, "unique"),
    origin: stringValue(result, row, "origin"),
    partial: booleanValue(result, row, "partial"),
    columns: [] as string[],
  }));
}

function indexColumnsFromResult(result: QueryResult) {
  return result.values.map((row) => stringValue(result, row, "name")).filter(Boolean);
}

function stringValue(result: QueryResult, row: unknown[], column: string) {
  const value = row[result.columns.indexOf(column)];
  return value == null ? "" : String(value);
}

function nullableStringValue(result: QueryResult, row: unknown[], column: string) {
  const value = row[result.columns.indexOf(column)];
  return value == null || value === "" ? null : String(value);
}

function numberValue(result: QueryResult, row: unknown[], column: string) {
  const numericValue = Number(row[result.columns.indexOf(column)]);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function booleanValue(result: QueryResult, row: unknown[], column: string) {
  return numberValue(result, row, column) === 1;
}

function pragmaIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quotedSqlIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function buildStarterQuery(objectName: string) {
  return `SELECT *\nFROM ${quotedSqlIdentifier(objectName)}\nLIMIT 100;`;
}

function openStarterQuery(query: string) {
  const draftId = crypto.randomUUID();
  const draftKey = `${SQL_EXPLORER_DRAFT_KEY}:${draftId}`;
  window.localStorage.setItem(draftKey, query.trim());

  const sqlExplorerUrl = href(`/sql?${SQL_EXPLORER_DRAFT_PARAM}=${encodeURIComponent(draftId)}`);
  const sqlExplorer = window.open(sqlExplorerUrl, "_blank");
  if (sqlExplorer) {
    sqlExplorer.opener = null;
  } else {
    window.location.hash = sqlExplorerUrl;
  }
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text.trim());
}
