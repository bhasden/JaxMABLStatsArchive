import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { Table, type ArchiveContext, usePageQuery } from "./queryHelpers";

const TABLES_SQL = `
SELECT
  type,
  name,
  sql
FROM sqlite_schema
WHERE type IN ('table', 'view')
  AND name NOT LIKE 'sqlite_%'
ORDER BY type, name;
`;

export function SchemaPage({
  archive,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const schema = usePageQuery(archive, TABLES_SQL, "Schema documentation");

  return (
    <div className="page-grid">
      <section className="section-head">
        <p className="eyebrow">Data portal</p>
        <h1>Schema</h1>
      </section>
      <section>
        <h2>Tables and Views</h2>
        <Table result={schema.result} columnHeaderMode={columnHeaderMode} query={schema.sql} />
      </section>
    </div>
  );
}
