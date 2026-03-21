import { AnalysisResult } from "@/types";

export interface UserAnalysisRecord {
  id: string;
  username: string;
  createdAt: number;
  result: AnalysisResult;
}

const RECORDS_KEY = "ep_analysis_records";
const MAX_RECORDS_PER_USER = 100;

const isBrowser = () => typeof window !== "undefined";

const readAllRecords = (): UserAnalysisRecord[] => {
  if (!isBrowser()) return [];

  try {
    const raw = window.localStorage.getItem(RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserAnalysisRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeAllRecords = (records: UserAnalysisRecord[]) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
};

export const getUserRecords = (username: string): UserAnalysisRecord[] => {
  const normalized = username.trim();
  if (!normalized) return [];

  return readAllRecords()
    .filter((record) => record.username === normalized)
    .sort((a, b) => b.createdAt - a.createdAt);
};

export const getUserRecordById = (
  username: string,
  recordId: string
): UserAnalysisRecord | null => {
  const normalized = username.trim();
  if (!normalized || !recordId) return null;

  const found = readAllRecords().find(
    (record) => record.username === normalized && record.id === recordId
  );

  return found || null;
};

export const saveUserRecord = (username: string, result: AnalysisResult) => {
  const normalized = username.trim();
  if (!normalized) return;

  const all = readAllRecords();

  const newRecord: UserAnalysisRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username: normalized,
    createdAt: Date.now(),
    result,
  };

  const merged = [newRecord, ...all];

  // Keep most recent records for each user, avoid unlimited growth.
  const byUserCount = new Map<string, number>();
  const trimmed: UserAnalysisRecord[] = [];

  for (const item of merged) {
    const count = byUserCount.get(item.username) || 0;
    if (count >= MAX_RECORDS_PER_USER) continue;

    byUserCount.set(item.username, count + 1);
    trimmed.push(item);
  }

  writeAllRecords(trimmed);
};

export const updateUserRecord = (
  username: string,
  recordId: string,
  result: AnalysisResult
): boolean => {
  const normalized = username.trim();
  if (!normalized || !recordId) return false;

  const all = readAllRecords();
  const next = all.map((item) => {
    if (item.username !== normalized || item.id !== recordId) return item;
    return { ...item, result };
  });

  writeAllRecords(next);
  return true;
};
