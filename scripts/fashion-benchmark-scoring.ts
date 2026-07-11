import type { FashionScanItem } from "../src/lib/fashion-scan";

export const SCORE_FIELDS = [
  "category",
  "color",
  "style",
  "pattern",
  "material",
  "visibleBrand",
] as const;

export type ScoreField = (typeof SCORE_FIELDS)[number];
export type FieldScoreStatus = "exact" | "close" | "wrong" | "unknown";

type ExpectedItem = Record<ScoreField, string | null>;

export type FieldScore = {
  expected: string | null;
  returned: string | null;
  status: FieldScoreStatus;
};

export type ItemScore = {
  expectedItemIndex: number;
  returnedItemIndex: number | null;
  returnedItemId: string | null;
  fields: Record<ScoreField, FieldScore>;
};

export type ScoreCounts = {
  exact: number;
  close: number;
  wrong: number;
  unknown: number;
  brandHallucinations: number;
};

export type BenchmarkScores = {
  items: ItemScore[];
  totals: ScoreCounts;
};

const CLOSE_EQUIVALENTS: Partial<Record<ScoreField, string[][]>> = {
  category: [
    ["top", "t shirt"],
    ["sleeveless t shirt", "tank top"],
  ],
  color: [
    ["tan", "beige"],
    ["off white", "cream"],
  ],
};

const STATUS_WEIGHT: Record<FieldScoreStatus, number> = {
  exact: 3,
  close: 2,
  wrong: 0,
  unknown: 0,
};

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function areClose(field: ScoreField, expected: string, returned: string) {
  return (CLOSE_EQUIVALENTS[field] ?? []).some(
    (group) => group.includes(expected) && group.includes(returned),
  );
}

export function scoreField(
  field: ScoreField,
  expectedValue: string | null,
  returnedValue: string | null,
): FieldScore {
  const expected = expectedValue ? normalize(expectedValue) : null;
  const returned = returnedValue ? normalize(returnedValue) : null;

  let status: FieldScoreStatus;
  if (!expected) {
    status = field === "visibleBrand" && returned ? "wrong" : "unknown";
  } else if (!returned) {
    status = "unknown";
  } else if (expected === returned) {
    status = "exact";
  } else if (areClose(field, expected, returned)) {
    status = "close";
  } else {
    status = "wrong";
  }

  return { expected: expectedValue, returned: returnedValue, status };
}

function scorePair(expected: ExpectedItem, returned: FashionScanItem | null) {
  return SCORE_FIELDS.reduce(
    (fields, field) => {
      fields[field] = scoreField(field, expected[field], returned?.[field] ?? null);
      return fields;
    },
    {} as Record<ScoreField, FieldScore>,
  );
}

function pairWeight(fields: Record<ScoreField, FieldScore>) {
  return SCORE_FIELDS.reduce((total, field) => total + STATUS_WEIGHT[fields[field].status], 0);
}

function emptyCounts(): ScoreCounts {
  return { exact: 0, close: 0, wrong: 0, unknown: 0, brandHallucinations: 0 };
}

export function scoreBenchmarkItems(
  expectedItems: ExpectedItem[],
  returnedItems: FashionScanItem[],
): BenchmarkScores {
  const items = expectedItems.map((expected, expectedItemIndex) => {
    let returnedItemIndex: number | null = null;
    let fields = scorePair(expected, null);
    let bestWeight = -1;

    returnedItems.forEach((returned, candidateIndex) => {
      const candidateFields = scorePair(expected, returned);
      const candidateWeight = pairWeight(candidateFields);
      if (candidateWeight > bestWeight) {
        bestWeight = candidateWeight;
        returnedItemIndex = candidateIndex;
        fields = candidateFields;
      }
    });

    return {
      expectedItemIndex,
      returnedItemIndex,
      returnedItemId: returnedItemIndex === null ? null : returnedItems[returnedItemIndex].id,
      fields,
    };
  });

  const totals = items.reduce((counts, item) => {
    for (const field of SCORE_FIELDS) {
      counts[item.fields[field].status] += 1;
    }
    const brand = item.fields.visibleBrand;
    if (brand.status === "wrong" && !brand.expected && brand.returned) {
      counts.brandHallucinations += 1;
    }
    return counts;
  }, emptyCounts());

  return { items, totals };
}
