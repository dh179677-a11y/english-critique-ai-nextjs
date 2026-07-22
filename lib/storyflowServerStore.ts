import { promises as fs } from "fs";
import path from "path";

import {
  normalizeAssignment,
  type StoryflowAssignment,
} from "@/lib/storyflowAssignments";
import {
  normalizeStoryflowDocument,
  normalizeStoryflowFolder,
  normalizeStoryflowTeacherSettings,
  type StoryflowDocument,
  type StoryflowFolder,
  type StoryflowTeacherSettings,
} from "@/lib/storyflowStore";

interface StoryflowStoreData {
  documents: StoryflowDocument[];
  folders: StoryflowFolder[];
  settings: StoryflowTeacherSettings[];
  assignments: StoryflowAssignment[];
}

const STORE_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(STORE_DIR, "storyflow-store.json");

const EMPTY_STORE: StoryflowStoreData = {
  documents: [],
  folders: [],
  settings: [],
  assignments: [],
};

let cachedStore: StoryflowStoreData | null = null;
let cachedStoreMtimeMs = 0;
let readStorePromise: Promise<StoryflowStoreData> | null = null;

function cloneEmptyStore(): StoryflowStoreData {
  return {
    documents: [],
    folders: [],
    settings: [],
    assignments: [],
  };
}

function normalizeStore(input: Partial<StoryflowStoreData> | null | undefined): StoryflowStoreData {
  const rawDocuments = Array.isArray(input?.documents) ? input.documents : [];
  const rawFolders = Array.isArray(input?.folders) ? input.folders : [];
  const rawSettings = Array.isArray(input?.settings) ? input.settings : [];
  const rawAssignments = Array.isArray(input?.assignments) ? input.assignments : [];

  return {
    documents: rawDocuments
      .map((item, index) => normalizeStoryflowDocument(item, rawDocuments.length - index))
      .filter((item): item is StoryflowDocument => Boolean(item)),
    folders: rawFolders
      .map((item, index) => normalizeStoryflowFolder(item, rawFolders.length - index))
      .filter((item): item is StoryflowFolder => Boolean(item)),
    settings: rawSettings
      .map((item) => normalizeStoryflowTeacherSettings(item))
      .filter((item): item is StoryflowTeacherSettings => Boolean(item)),
    assignments: rawAssignments
      .map((item) => normalizeAssignment(item))
      .filter((item): item is StoryflowAssignment => Boolean(item))
      .sort((left, right) => right.updatedAt - left.updatedAt),
  };
}

async function ensureStoreFile() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_FILE);
  } catch {
    await fs.writeFile(STORE_FILE, JSON.stringify(EMPTY_STORE, null, 2), "utf8");
  }
}

export async function readStoryflowStore(): Promise<StoryflowStoreData> {
  await ensureStoreFile();

  const fileStat = await fs.stat(STORE_FILE);
  if (cachedStore && cachedStoreMtimeMs === fileStat.mtimeMs) {
    return cachedStore;
  }

  if (readStorePromise) {
    return readStorePromise;
  }

  readStorePromise = (async () => {
    try {
      const raw = await fs.readFile(STORE_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoryflowStoreData>;
      const normalized = normalizeStore(parsed);
      const normalizedRaw = JSON.stringify(normalized, null, 2);
      let nextMtimeMs = fileStat.mtimeMs;

      if (normalizedRaw !== raw) {
        try {
          await fs.writeFile(STORE_FILE, normalizedRaw, "utf8");
          nextMtimeMs = (await fs.stat(STORE_FILE)).mtimeMs;
        } catch (error) {
          console.error("Failed to persist normalized storyflow store:", error);
        }
      }

      cachedStore = normalized;
      cachedStoreMtimeMs = nextMtimeMs;
      return normalized;
    } catch {
      const emptyStore = cloneEmptyStore();
      cachedStore = emptyStore;
      cachedStoreMtimeMs = fileStat.mtimeMs;
      return emptyStore;
    } finally {
      readStorePromise = null;
    }
  })();

  return readStorePromise;
}

export async function writeStoryflowStore(data: StoryflowStoreData) {
  await ensureStoreFile();
  const normalized = normalizeStore(data);
  await fs.writeFile(STORE_FILE, JSON.stringify(normalized, null, 2), "utf8");
  cachedStore = normalized;
  cachedStoreMtimeMs = (await fs.stat(STORE_FILE)).mtimeMs;
}

export async function updateStoryflowStore(
  updater: (current: StoryflowStoreData) => StoryflowStoreData | Promise<StoryflowStoreData>
) {
  const current = await readStoryflowStore();
  const next = normalizeStore(await updater(current));
  await writeStoryflowStore(next);
  return next;
}
