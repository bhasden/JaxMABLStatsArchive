import { useMemo, useState } from "react";
import type { QueryResult } from "../data/archiveDb";
import { buildPeopleIndexSql } from "../data/personQueries";
import type { ColumnHeaderMode } from "../hooks/useColumnHeaderMode";
import { href } from "../hooks/useHashRoute";
import { Table, usePageQuery, type ArchiveContext } from "./queryHelpers";

export function PeoplePage({
  archive,
  columnHeaderMode,
}: {
  archive: ArchiveContext;
  columnHeaderMode: ColumnHeaderMode;
}) {
  const [search, setSearch] = useState("");
  const people = usePageQuery(archive, buildPeopleIndexSql(), "Archive people index");
  const filteredResult = useMemo(
    () => filterResult(people.result, search, ["person_name", "person_id"]),
    [people.result, search],
  );

  return (
    <div className="page-grid">
      <section className="page-hero">
        <p className="eyebrow">Archive Workbench</p>
        <h1>People</h1>
      </section>

      <section>
        <div className="section-title-row">
          <h2>Person Index</h2>
          <label className="browse-search">
            <span>Filter people</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or person ID" />
          </label>
        </div>
        {people.error ? <div className="notice error">{people.error}</div> : null}
        <Table
          result={filteredResult}
          query={people.sql}
          columnHeaderMode={columnHeaderMode}
          hiddenColumns={[]}
          cellHref={({ column, row, columns }) => {
            if (column !== "person_name") {
              return undefined;
            }
            const personId = row[columns.indexOf("person_id")];
            return typeof personId === "number" ? href(`/people/${personId}`) : undefined;
          }}
        />
      </section>
    </div>
  );
}

function filterResult(result: QueryResult | null, search: string, columns: string[]): QueryResult | null {
  const trimmedSearch = search.trim().toLowerCase();
  if (!result || !trimmedSearch) {
    return result;
  }

  const searchableIndexes = columns.map((column) => result.columns.indexOf(column)).filter((index) => index >= 0);

  return {
    ...result,
    values: result.values.filter((row) =>
      searchableIndexes.some((index) =>
        String(row[index] ?? "")
          .toLowerCase()
          .includes(trimmedSearch),
      ),
    ),
  };
}
