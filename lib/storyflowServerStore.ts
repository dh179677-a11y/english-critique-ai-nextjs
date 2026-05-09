import { promises as fs } from "fs";
import path from "path";

import {
  normalizeAssignment,
  type StoryflowAssignment,
} from "@/lib/storyflowAssignments";
import {
  normalizeStoryflowDocument,
  normalizeStoryflowFolder,
  type StoryflowDocument,
  type StoryflowFolder,
} from "@/lib/storyflowStore";

interface StoryflowStoreData {
  documents: StoryflowDocument[];
  folders: StoryflowFolder[];
  assignments: StoryflowAssignment[];
}

const STORE_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(STORE_DIR, "storyflow-store.json");

const EMPTY_STORE: StoryflowStoreData = {
  documents: [],
  folders: [],
  assignments: [],
};

function cloneEmptyStore(): StoryflowStoreData {
  return {
    documents: [],
    folders: [],
    assignments: [],
  };
}

function normalizeStore(input: Partial<StoryflowStoreData> | null | undefined): StoryflowStoreData {
  const rawDocuments = Array.isArray(input?.documents) ? input.documents : [];
  const rawFolders = Array.isArray(input?.folders) ? input.folders : [];
  const rawAssignments = Array.isArray(input?.assignments) ? input.assignments : [];

  return {
    documents: rawDocuments
      .map((item, index) => normalizeStoryflowDocument(item, rawDocuments.length - index))
      .filter((item): item is StoryflowDocument => Boolean(item)),
    folders: rawFolders
      .map((item, index) => normalizeStoryflowFolder(item, rawFolders.length - index))
      .filter((item): item is StoryflowFolder => Boolean(item)),
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

  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoryflowStoreData>;
    const normalized = normalizeStore(parsed);
    const normalizedRaw = JSON.stringify(normalized, null, 2);

    if (normalizedRaw !== raw) {
      try {
        await fs.writeFile(STORE_FILE, normalizedRaw, "utf8");
      } catch (error) {
        console.error("Failed to persist normalized storyflow store:", error);
      }
    }

    return normalized;
  } catch {
    return cloneEmptyStore();
  }
}

export async function writeStoryflowStore(data: StoryflowStoreData) {
  await ensureStoreFile();
  await fs.writeFile(STORE_FILE, JSON.stringify(normalizeStore(data), null, 2), "utf8");
}

export async function updateStoryflowStore(
  updater: (current: StoryflowStoreData) => StoryflowStoreData | Promise<StoryflowStoreData>
) {
  const current = await readStoryflowStore();
  const next = normalizeStore(await updater(current));
  await writeStoryflowStore(next);
  return next;
}
