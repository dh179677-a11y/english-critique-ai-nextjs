"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import TeacherShell from "@/components/teacher/TeacherShell";
import { getSessionProfile, type SessionUser } from "@/lib/clientAuth";
import {
  createTeacherStoryflowFolder,
  deleteTeacherStoryflowFolder,
  getTeacherStoryflowDocuments,
  getTeacherStoryflowFolders,
  reorderTeacherStoryflowDocuments,
  reorderTeacherStoryflowFolders,
  updateTeacherStoryflowDocument,
  updateTeacherStoryflowFolder,
  type StoryflowDocument,
  type StoryflowFolder,
} from "@/lib/storyflowStore";

type FolderFilter = "all" | "root" | string;
type SortMode = "manual" | "newest" | "oldest" | "title" | "pages" | "updated";

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));

const fetchStoryflowUrls = async (objectKeys: string[]) => {
  const response = await fetch("/api/storyflow/urls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ objectKeys }),
  });

  const payload = (await response.json()) as
    | { urls: Record<string, string> }
    | { error: string };

  if (!response.ok || "error" in payload) {
    throw new Error("error" in payload ? payload.error : "地址生成失败");
  }

  return payload.urls;
};

const isDisplayUrl = (value?: string | null) =>
  typeof value === "string" &&
  (value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("http://") ||
    value.startsWith("https://"));

function TeacherStoryflowLibraryContent() {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [documents, setDocuments] = useState<StoryflowDocument[]>([]);
  const [folders, setFolders] = useState<StoryflowFolder[]>([]);
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [newFolderName, setNewFolderName] = useState("");
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSession(getSessionProfile());
  }, []);

  const refreshData = (teacherUsername: string) => {
    setDocuments(getTeacherStoryflowDocuments(teacherUsername));
    setFolders(getTeacherStoryflowFolders(teacherUsername));
  };

  useEffect(() => {
    if (!session) return;
    refreshData(session.username);
  }, [session]);

  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    documents.forEach((item) => {
      nextDrafts[item.id] = item.category || "";
    });
    setCategoryDrafts(nextDrafts);
  }, [documents]);

  useEffect(() => {
    const objectKeys = Array.from(
      new Set(
        documents
          .map((item) => item.pageObjectKeys?.[0] || item.thumbnailObjectKey || "")
          .filter(Boolean)
      )
    );

    if (!objectKeys.length) {
      setCoverUrls({});
      return;
    }

    let disposed = false;

    void fetchStoryflowUrls(objectKeys)
      .then((urls) => {
        if (!disposed) {
          setCoverUrls(urls);
        }
      })
      .catch(() => {
        if (!disposed) {
          setCoverUrls({});
        }
      });

    return () => {
      disposed = true;
    };
  }, [documents]);

  const folderCountById = useMemo(() => {
    const counts = new Map<string, number>();
    documents.forEach((item) => {
      const key = item.folderId || "root";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [documents]);

  const uniqueCategories = useMemo(
    () =>
      [...new Set(documents.map((item) => (item.category || "").trim()).filter(Boolean))].sort(
        (left, right) =>
          left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })
      ),
    [documents]
  );

  const filteredDocuments = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const base = documents.filter((item) => {
      if (folderFilter === "root" && item.folderId) return false;
      if (folderFilter !== "all" && folderFilter !== "root" && item.folderId !== folderFilter) {
        return false;
      }

      if (!keyword) return true;

      const haystack = [
        item.analysis.title,
        item.sourceName,
        item.analysis.summary,
        item.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(keyword);
    });

    if (sortMode === "manual") {
      return base;
    }

    const sorted = [...base];
    sorted.sort((left, right) => {
      if (sortMode === "newest") {
        return right.createdAt - left.createdAt;
      }
      if (sortMode === "oldest") {
        return left.createdAt - right.createdAt;
      }
      if (sortMode === "pages") {
        const pageDiff = right.pageCount - left.pageCount;
        return pageDiff !== 0 ? pageDiff : right.createdAt - left.createdAt;
      }
      if (sortMode === "updated") {
        return (right.updatedAt || right.createdAt) - (left.updatedAt || left.createdAt);
      }
      return left.analysis.title.localeCompare(right.analysis.title, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
    return sorted;
  }, [documents, folderFilter, search, sortMode]);

  const moveDocument = (documentId: string, direction: -1 | 1) => {
    if (!session) return;
    const visibleIds = filteredDocuments.map((item) => item.id);
    const currentIndex = visibleIds.indexOf(documentId);
    const targetId = visibleIds[currentIndex + direction];
    if (currentIndex < 0 || !targetId) return;

    const manualIds = documents.map((item) => item.id);
    const sourceOrderIndex = manualIds.indexOf(documentId);
    const targetOrderIndex = manualIds.indexOf(targetId);
    if (sourceOrderIndex < 0 || targetOrderIndex < 0) return;

    const nextIds = [...manualIds];
    [nextIds[sourceOrderIndex], nextIds[targetOrderIndex]] = [
      nextIds[targetOrderIndex],
      nextIds[sourceOrderIndex],
    ];
    reorderTeacherStoryflowDocuments(session.username, nextIds);
    refreshData(session.username);
    setError(null);
    setNotice("资料顺序已更新。");
  };

  const moveFolder = (folderId: string, direction: -1 | 1) => {
    if (!session) return;
    const folderIds = folders.map((item) => item.id);
    const currentIndex = folderIds.indexOf(folderId);
    const targetId = folderIds[currentIndex + direction];
    if (currentIndex < 0 || !targetId) return;

    const nextIds = [...folderIds];
    [nextIds[currentIndex], nextIds[currentIndex + direction]] = [
      nextIds[currentIndex + direction],
      nextIds[currentIndex],
    ];
    reorderTeacherStoryflowFolders(session.username, nextIds);
    refreshData(session.username);
    setError(null);
    setNotice("文件夹顺序已更新。");
  };

  const updateDocumentMeta = (
    documentId: string,
    updater: (document: StoryflowDocument) => StoryflowDocument,
    successMessage: string
  ) => {
    if (!session) return;
    updateTeacherStoryflowDocument(session.username, documentId, updater);
    refreshData(session.username);
    setError(null);
    setNotice(successMessage);
  };

  const createFolder = () => {
    if (!session) return;
    try {
      createTeacherStoryflowFolder(session.username, newFolderName);
      refreshData(session.username);
      setNewFolderName("");
      setNotice("文件夹已创建。");
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建文件夹失败");
    }
  };

  const renameFolder = (folder: StoryflowFolder) => {
    if (!session) return;
    const nextName = window.prompt("输入新的文件夹名称", folder.name)?.trim();
    if (!nextName || nextName === folder.name) return;
    updateTeacherStoryflowFolder(session.username, folder.id, (current) => ({
      ...current,
      name: nextName,
    }));
    refreshData(session.username);
    setError(null);
    setNotice("文件夹名称已更新。");
  };

  const removeFolder = (folder: StoryflowFolder) => {
    if (!session) return;
    if (!window.confirm(`确认删除文件夹“${folder.name}”吗？文件会回到根目录。`)) return;
    deleteTeacherStoryflowFolder(session.username, folder.id);
    if (folderFilter === folder.id) {
      setFolderFilter("all");
    }
    refreshData(session.username);
    setError(null);
    setNotice("文件夹已删除，资料已移回根目录。");
  };

  const saveCategory = (documentId: string) => {
    const nextCategory = (categoryDrafts[documentId] || "").trim();
    updateDocumentMeta(
      documentId,
      (document) => ({
        ...document,
        category: nextCategory,
      }),
      nextCategory ? "分类已保存。" : "分类已清空。"
    );
  };

  if (!session) {
    return null;
  }

  return (
    <TeacherShell
      session={session}
      title="资料整理"
      subtitle="老师资料库已取消数量上限。你可以在这里创建文件夹、设置分类，并按自己的教学顺序整理全部资料。"
      backHref="/teacher/storyflow"
      actions={
        <Link
          href="/teacher/storyflow"
          className="rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          返回图文导学
        </Link>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-[1.7rem] border border-white/80 bg-white/80 p-4 shadow-[0_18px_50px_rgba(148,163,184,0.12)]">
          <div className="rounded-[1.4rem] bg-slate-900 px-4 py-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
              Library
            </p>
            <p className="mt-3 text-3xl font-black">{documents.length}</p>
            <p className="mt-1 text-sm text-white/80">当前资料总数</p>
          </div>

          <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-black text-slate-900">新建文件夹</p>
            <div className="mt-3 flex gap-2">
              <input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createFolder();
                  }
                }}
                placeholder="例如：一年级上 / 绘本精读"
                className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-300"
              />
              <button
                type="button"
                onClick={createFolder}
                className="rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
              >
                创建
              </button>
            </div>
          </div>

          <div className="rounded-[1.4rem] border border-slate-200 bg-white p-3">
            <p className="px-2 text-sm font-black text-slate-900">文件夹</p>
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => setFolderFilter("all")}
                className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm transition ${
                  folderFilter === "all"
                    ? "bg-sky-50 font-semibold text-sky-700"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>全部资料</span>
                <span>{documents.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setFolderFilter("root")}
                className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm transition ${
                  folderFilter === "root"
                    ? "bg-sky-50 font-semibold text-sky-700"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>根目录</span>
                <span>{folderCountById.get("root") || 0}</span>
              </button>

              {folders.map((folder, index) => (
                <div
                  key={folder.id}
                  className={`rounded-2xl border px-3 py-3 ${
                    folderFilter === folder.id
                      ? "border-sky-200 bg-sky-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setFolderFilter(folder.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
                        {folder.name}
                      </p>
                      <span className="text-xs text-slate-500">
                        {folderCountById.get(folder.id) || 0}
                      </span>
                    </div>
                  </button>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveFolder(folder.id, -1)}
                      className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      disabled={index === folders.length - 1}
                      onClick={() => moveFolder(folder.id, 1)}
                      className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      onClick={() => renameFolder(folder)}
                      className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFolder(folder)}
                      className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="space-y-4">
          <div className="rounded-[1.7rem] border border-white/80 bg-white/80 p-4 shadow-[0_18px_50px_rgba(148,163,184,0.12)]">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_180px_180px]">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索标题、摘要、分类"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300"
              />
              <select
                value={folderFilter}
                onChange={(event) => setFolderFilter(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300"
              >
                <option value="all">全部目录</option>
                <option value="root">根目录</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300"
              >
                <option value="manual">手动排列</option>
                <option value="newest">按创建时间从新到旧</option>
                <option value="oldest">按创建时间从旧到新</option>
                <option value="updated">按最近编辑</option>
                <option value="title">按标题字母</option>
                <option value="pages">按页数</option>
              </select>
            </div>

            {uniqueCategories.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {uniqueCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setSearch(category)}
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
                  >
                    {category}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
              {notice}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {filteredDocuments.length ? (
              filteredDocuments.map((item, index) => {
                const folderName =
                  folders.find((folder) => folder.id === item.folderId)?.name || "根目录";
                const coverObjectKey = item.pageObjectKeys?.[0] || item.thumbnailObjectKey || "";
                const coverUrl =
                  (isDisplayUrl(item.images?.[0]) ? item.images?.[0] || "" : "") ||
                  (isDisplayUrl(item.thumbnail) ? item.thumbnail : "") ||
                  (coverObjectKey ? coverUrls[coverObjectKey] || "" : "");

                return (
                  <article
                    key={item.id}
                    className="rounded-[1.7rem] border border-white/80 bg-white p-4 shadow-[0_18px_50px_rgba(148,163,184,0.12)]"
                  >
                    <div className="flex gap-3">
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt={item.analysis.title}
                          className="h-24 w-24 rounded-[1.3rem] object-cover"
                        />
                      ) : (
                        <div className="grid h-24 w-24 place-items-center rounded-[1.3rem] bg-sky-100 text-2xl font-black text-sky-700">
                          图
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-lg font-black text-slate-900">
                          {item.analysis.title || item.sourceName}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                          {item.analysis.summary || "暂无摘要"}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1">
                            {item.pageCount} 页
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1">
                            创建于 {formatTime(item.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3">
                      <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        文件夹
                        <select
                          value={item.folderId || "root"}
                          onChange={(event) => {
                            const nextFolderId = event.target.value === "root" ? null : event.target.value;
                            updateDocumentMeta(
                              item.id,
                              (document) => ({
                                ...document,
                                folderId: nextFolderId,
                              }),
                              "文件夹已更新。"
                            );
                          }}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-sky-300"
                        >
                          <option value="root">根目录</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        分类
                        <input
                          value={categoryDrafts[item.id] || ""}
                          onChange={(event) =>
                            setCategoryDrafts((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                          onBlur={() => saveCategory(item.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              saveCategory(item.id);
                            }
                          }}
                          placeholder="例如：绘本精读 / 复述 / 口语"
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-sky-300"
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        {folderName}
                      </span>
                      {item.category ? (
                        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                          {item.category}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={`/teacher/storyflow?doc=${item.id}`}
                        className="rounded-full bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                      >
                        打开编辑
                      </Link>
                      {sortMode === "manual" ? (
                        <>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveDocument(item.id, -1)}
                            className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-300"
                          >
                            上移
                          </button>
                          <button
                            type="button"
                            disabled={index === filteredDocuments.length - 1}
                            onClick={() => moveDocument(item.id, 1)}
                            className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-300"
                          >
                            下移
                          </button>
                        </>
                      ) : null}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="rounded-[1.7rem] border border-dashed border-slate-200 bg-white/70 px-5 py-10 text-center text-sm text-slate-500 md:col-span-2 2xl:col-span-3">
                当前筛选条件下没有资料。
              </div>
            )}
          </div>
        </section>
      </div>
    </TeacherShell>
  );
}

export default function TeacherStoryflowLibraryPage() {
  return (
    <AuthGate allowedRoles={["teacher"]}>
      <TeacherStoryflowLibraryContent />
    </AuthGate>
  );
}
