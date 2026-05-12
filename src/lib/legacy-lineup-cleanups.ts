export type LegacyLineupModifier = "A" | "B" | "R";

export type LegacyLineupInputRow = {
  gameid: number;
  teamid: number;
  playerid: number | null;
  lineup: number | null;
  lineup2: number | null;
};

export type LegacyLineupNormalizedRow<T extends LegacyLineupInputRow = LegacyLineupInputRow> = T & {
  source_batting_order: number | null;
  source_batting_order_slot: number | null;
  batting_order: number | null;
  batting_order_modifier: LegacyLineupModifier | null;
};

export type LegacyLineupCleanupStats = {
  allZeroGroups: number;
  sameAsOrderGroups: number;
  unusualSlotValues: Map<number, number>;
};

export function createLegacyLineupCleanupStats(): LegacyLineupCleanupStats {
  return {
    allZeroGroups: 0,
    sameAsOrderGroups: 0,
    unusualSlotValues: new Map<number, number>(),
  };
}

export function mergeLegacyLineupCleanupStats(target: LegacyLineupCleanupStats, source: LegacyLineupCleanupStats) {
  target.allZeroGroups += source.allZeroGroups;
  target.sameAsOrderGroups += source.sameAsOrderGroups;
  for (const [slot, count] of source.unusualSlotValues) {
    target.unusualSlotValues.set(slot, (target.unusualSlotValues.get(slot) ?? 0) + count);
  }
}

export function formatLegacyLineupCleanupStats(stats: LegacyLineupCleanupStats) {
  const unusualSlots = [...stats.unusualSlotValues.entries()]
    .sort(([left], [right]) => left - right)
    .map(([slot, count]) => `${slot} (${count})`)
    .join(", ");

  return [
    "Applied legacy lineup cleanups:",
    `${stats.allZeroGroups} all-zero game/team groups`,
    `${stats.sameAsOrderGroups} same-as-order game/team groups`,
    unusualSlots ? `unusual lineup2 values: ${unusualSlots}` : "no unusual lineup2 values",
  ].join(" ");
}

export function normalizeLegacyLineupRows<T extends LegacyLineupInputRow>(rows: T[]) {
  const stats = createLegacyLineupCleanupStats();
  const normalized: LegacyLineupNormalizedRow<T>[] = [];
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = `${row.gameid}:${row.teamid}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    normalized.push(...normalizeLegacyLineupGroup(group, stats));
  }

  return { rows: normalized, stats };
}

function normalizeLegacyLineupGroup<T extends LegacyLineupInputRow>(
  group: T[],
  stats: LegacyLineupCleanupStats,
): LegacyLineupNormalizedRow<T>[] {
  const allZero = group.every((row) => normalizeNumber(row.lineup) === 0 && normalizeNumber(row.lineup2) === 0);
  if (allZero) {
    stats.allZeroGroups += 1;
    return group.map((row) => buildNormalizedRow(row, null, null));
  }

  const rowsWithNonzeroSlot = group.filter((row) => {
    const order = normalizeNumber(row.lineup);
    const slot = normalizeNumber(row.lineup2);
    return order != null && order > 0 && slot != null && slot > 0;
  });
  const sameAsOrder =
    rowsWithNonzeroSlot.length > 0 &&
    rowsWithNonzeroSlot.every((row) => normalizeNumber(row.lineup) === normalizeNumber(row.lineup2));

  if (sameAsOrder) {
    stats.sameAsOrderGroups += 1;
    return group.map((row) => buildNormalizedRow(row, positiveNumber(row.lineup), null));
  }

  return group.map((row) => {
    const order = positiveNumber(row.lineup);
    const slot = normalizeNumber(row.lineup2);
    const modifier = legacyLineupModifier(slot);

    if (slot != null && slot !== 0 && !modifier) {
      stats.unusualSlotValues.set(slot, (stats.unusualSlotValues.get(slot) ?? 0) + 1);
    }

    return buildNormalizedRow(row, order, modifier);
  });
}

function buildNormalizedRow<T extends LegacyLineupInputRow>(
  row: T,
  battingOrder: number | null,
  battingOrderModifier: LegacyLineupModifier | null,
): LegacyLineupNormalizedRow<T> {
  return {
    ...row,
    source_batting_order: normalizeNumber(row.lineup),
    source_batting_order_slot: normalizeNumber(row.lineup2),
    batting_order: battingOrder,
    batting_order_modifier: battingOrderModifier,
  };
}

function normalizeNumber(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

function positiveNumber(value: number | null) {
  const normalized = normalizeNumber(value);
  return normalized != null && normalized > 0 ? normalized : null;
}

function legacyLineupModifier(value: number | null): LegacyLineupModifier | null {
  switch (value) {
    case 1:
      return "A";
    case 2:
      return "B";
    case 3:
      return "R";
    default:
      return null;
  }
}
