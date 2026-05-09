import { promises as fs } from "fs";
import path from "path";

import type { AppUser, TeacherClass } from "@/lib/clientAuth";
import type { UserAnalysisRecord } from "@/lib/clientRecords";
import { hashPassword } from "@/lib/passwordSecurity";

interface PortalStoreData {
  users: AppUser[];
  classes: TeacherClass[];
  records: UserAnalysisRecord[];
}

const STORE_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(STORE_DIR, "portal-store.json");

const EMPTY_STORE: PortalStoreData = {
  users: [],
  classes: [],
  records: [],
};

let cachedStore: PortalStoreData | null = null;
let cachedStoreMtimeMs = 0;
let readStorePromise: Promise<PortalStoreData> | null = null;

function cloneEmptyStore(): PortalStoreData {
  return {
    users: [],
    classes: [],
    records: [],
  };
}

function secureStoredUser(user: AppUser): AppUser {
  if (user.passwordHash && user.passwordSalt) {
    return {
      ...user,
      password: "",
    };
  }

  if (!user.password) {
    return user;
  }

  const { passwordHash, passwordSalt } = hashPassword(user.password);

  return {
    ...user,
    password: "",
    passwordHash,
    passwordSalt,
  };
}

function normalizeStore(input: Partial<PortalStoreData> | null | undefined): PortalStoreData {
  return {
    users: Array.isArray(input?.users) ? input.users.map(secureStoredUser) : [],
    classes: Array.isArray(input?.classes) ? input.classes : [],
    records: Array.isArray(input?.records) ? input.records : [],
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

export async function readPortalStore(): Promise<PortalStoreData> {
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
      const parsed = JSON.parse(raw) as Partial<PortalStoreData>;
      const normalized = normalizeStore(parsed);
      const normalizedRaw = JSON.stringify(normalized, null, 2);
      let nextMtimeMs = fileStat.mtimeMs;

      if (normalizedRaw !== raw) {
        try {
          await fs.writeFile(STORE_FILE, normalizedRaw, "utf8");
          nextMtimeMs = (await fs.stat(STORE_FILE)).mtimeMs;
        } catch (error) {
          console.error("Failed to persist normalized portal store:", error);
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

export async function writePortalStore(data: PortalStoreData) {
  await ensureStoreFile();
  const normalized = normalizeStore(data);
  await fs.writeFile(STORE_FILE, JSON.stringify(normalized, null, 2), "utf8");
  cachedStore = normalized;
  cachedStoreMtimeMs = (await fs.stat(STORE_FILE)).mtimeMs;
}

export async function updatePortalStore(
  updater: (current: PortalStoreData) => PortalStoreData | Promise<PortalStoreData>
) {
  const current = await readPortalStore();
  const next = normalizeStore(await updater(current));
  await writePortalStore(next);
  return next;
}
