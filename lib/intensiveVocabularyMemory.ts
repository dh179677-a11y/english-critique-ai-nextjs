export type IntensiveVocabularyPage = {
  keyVocabulary?: string[];
};

export type IntensiveVocabularyMemoryEntry = {
  family: string;
  forms: string[];
  lastPageIndex: number;
};

const INTENSIVE_VOCABULARY_STOP_WORDS = new Set([
  "a",
  "am",
  "an",
  "and",
  "are",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "for",
  "from",
  "he",
  "i",
  "in",
  "is",
  "it",
  "left",
  "of",
  "on",
  "or",
  "right",
  "she",
  "that",
  "the",
  "these",
  "they",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "with",
  "you",
]);

const IRREGULAR_INTENSIVE_VOCABULARY_FAMILIES: Record<string, string> = {
  came: "come",
  children: "child",
  feet: "foot",
  gone: "go",
  men: "man",
  mice: "mouse",
  saw: "see",
  seen: "see",
  teeth: "tooth",
  went: "go",
  women: "woman",
};

const cleanVocabularyForm = (word: string) =>
  word.trim().match(/[A-Za-z]+(?:'[A-Za-z]+)?/u)?.[0] || "";

export function normalizeIntensiveVocabularyFamily(word: string) {
  const cleaned = cleanVocabularyForm(word).toLowerCase();
  if (!cleaned || INTENSIVE_VOCABULARY_STOP_WORDS.has(cleaned)) return "";

  const irregularFamily = IRREGULAR_INTENSIVE_VOCABULARY_FAMILIES[cleaned];
  if (irregularFamily) return irregularFamily;

  if (cleaned.length > 4 && cleaned.endsWith("ies")) {
    return `${cleaned.slice(0, -3)}y`;
  }

  if (
    cleaned.length > 4 &&
    cleaned.endsWith("es") &&
    /(ches|shes|xes|zes|oes)$/u.test(cleaned)
  ) {
    return cleaned.slice(0, -2);
  }

  if (cleaned.length > 4 && cleaned.endsWith("ed")) {
    return cleaned.slice(0, -2);
  }

  if (
    cleaned.length > 3 &&
    cleaned.endsWith("s") &&
    !/(ss|us|is)$/u.test(cleaned)
  ) {
    return cleaned.slice(0, -1);
  }

  return cleaned;
}

export function buildPreviouslyTaughtVocabulary(
  pages: IntensiveVocabularyPage[],
  currentPageIndex: number,
  limit = 24
) {
  const safeCurrentPageIndex = Math.max(0, Math.floor(currentPageIndex));
  const currentFamilies = new Set(
    (pages[safeCurrentPageIndex]?.keyVocabulary || [])
      .map((word) => normalizeIntensiveVocabularyFamily(word))
      .filter(Boolean)
  );
  const entries = new Map<string, IntensiveVocabularyMemoryEntry>();

  pages.slice(0, safeCurrentPageIndex).forEach((page, pageIndex) => {
    (page.keyVocabulary || []).forEach((word) => {
      const form = cleanVocabularyForm(word);
      const family = normalizeIntensiveVocabularyFamily(form);
      if (!family || !form) return;

      const existing = entries.get(family);
      if (existing) {
        if (!existing.forms.some((item) => item.toLowerCase() === form.toLowerCase())) {
          existing.forms.push(form);
        }
        existing.lastPageIndex = pageIndex;
        return;
      }

      entries.set(family, {
        family,
        forms: [form],
        lastPageIndex: pageIndex,
      });
    });
  });

  const safeLimit = Math.min(32, Math.max(1, Math.floor(limit) || 24));

  return [...entries.values()]
    .sort((left, right) => {
      const leftRepeatsNow = currentFamilies.has(left.family) ? 1 : 0;
      const rightRepeatsNow = currentFamilies.has(right.family) ? 1 : 0;
      if (leftRepeatsNow !== rightRepeatsNow) {
        return rightRepeatsNow - leftRepeatsNow;
      }
      if (left.lastPageIndex !== right.lastPageIndex) {
        return right.lastPageIndex - left.lastPageIndex;
      }
      return left.family.localeCompare(right.family);
    })
    .slice(0, safeLimit);
}

export function formatPreviouslyTaughtVocabularyPrompt(
  entries: IntensiveVocabularyMemoryEntry[]
) {
  const heading = "【本次绘本此前已经精讲的词族】";
  if (!entries.length) return `${heading}\n暂无。`;

  return [
    heading,
    ...entries.map(
      (entry) => `${entry.family}（此前形式：${entry.forms.join("、")}）`
    ),
    "上述词族再次出现时，最多用一句话简短回顾它在当前句中的意思。",
    "不得重复词性、完整词义列表、常见搭配、发音拆解或生活例句；优先讲当前页第一次出现的新重点词。",
  ].join("\n");
}
