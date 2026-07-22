"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import type { SessionUser } from "@/lib/clientAuth";
import {
  getStudentStoryflowAssignments,
  hydrateStudentStoryflowAssignments,
  primeStudentStoryflowAssignments,
  type StoryflowAssignment,
} from "@/lib/storyflowAssignments";
import {
  getTeacherStoryflowDocuments,
  hydrateAccessibleStoryflowDocumentsForTeachers,
  primeAccessibleTeacherStoryflowDocuments,
  type StoryflowDocument,
  type StoryflowFolder,
  type StoryflowStudentTaskDisplayMode,
} from "@/lib/storyflowStore";

export type StudentTaskCard = StoryflowAssignment & {
  folderId?: string | null;
  documentSortOrder: number;
  lastStudiedAt: number;
  coverObjectKey: string;
  coverImageUrl: string;
};

interface StudentTasksClientProps {
  session: SessionUser;
  initialTaskCards: StudentTaskCard[];
  initialDocumentsByTeacher: Record<string, StoryflowDocument[]>;
  initialFoldersByTeacher: Record<string, StoryflowFolder[]>;
  initialDisplayMode: StoryflowStudentTaskDisplayMode;
}

interface CourseLevelGroup {
  key: string;
  name: string;
  teacherUsername: string;
  folder?: StoryflowFolder;
  tasks: StudentTaskCard[];
  coverImageUrl: string;
  latestStudiedAt: number;
  sortOrder: number;
}

interface CourseCardShellArgs {
  cardKey: string;
  href?: string;
  onClick?: () => void;
  cover: React.ReactNode;
  detailText: React.ReactNode;
  actionText: string;
}

const isDisplayUrl = (value?: string | null) =>
  typeof value === "string" &&
  (value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("http://") ||
    value.startsWith("https://"));

const getStoryflowFileProxyUrl = (objectKey?: string | null) =>
  objectKey ? `/api/storyflow/file?key=${encodeURIComponent(objectKey)}` : "";

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(timestamp));

const getAssignmentLastStudiedAt = (task: StoryflowAssignment) =>
  Math.max(
    task.shadowSubmission?.completedAt || 0,
    task.speakingSubmission?.completedAt || 0
  );

const getDocumentSortValue = (document?: StoryflowDocument | null) =>
  typeof document?.sortOrder === "number" && Number.isFinite(document.sortOrder)
    ? document.sortOrder
    : document?.updatedAt || document?.createdAt || 0;

const getDocumentCoverImageUrl = (document?: StoryflowDocument | null) => {
  if (!document) return "";

  const localImage = document.images?.[0];
  if (isDisplayUrl(localImage)) return localImage || "";
  if (isDisplayUrl(document.thumbnail)) return document.thumbnail || "";

  return getStoryflowFileProxyUrl(
    document.pageObjectKeys?.[0] || document.thumbnailObjectKey || ""
  );
};

const getFolderCoverImageUrl = (
  folder: StoryflowFolder | undefined,
  tasks: StudentTaskCard[]
) => {
  if (isDisplayUrl(folder?.coverImage)) return folder?.coverImage || "";
  if (folder?.coverObjectKey) return getStoryflowFileProxyUrl(folder.coverObjectKey);
  return tasks.find((task) => task.coverImageUrl)?.coverImageUrl || "";
};

const buildTaskCards = (tasks: StoryflowAssignment[]) =>
  tasks.map((task) => {
    const document = getTeacherStoryflowDocuments(task.teacherUsername).find(
      (item) => item.id === task.documentId
    );
    return {
      ...task,
      folderId: document?.folderId || null,
      documentSortOrder: getDocumentSortValue(document),
      lastStudiedAt: getAssignmentLastStudiedAt(task),
      coverObjectKey:
        document?.pageObjectKeys?.[0] || document?.thumbnailObjectKey || "",
      coverImageUrl: getDocumentCoverImageUrl(document),
    } satisfies StudentTaskCard;
  });

export default function StudentTasksClient({
  session,
  initialTaskCards,
  initialDocumentsByTeacher,
  initialFoldersByTeacher,
  initialDisplayMode,
}: StudentTasksClientProps) {
  const [taskCards, setTaskCards] = useState<StudentTaskCard[]>(initialTaskCards);
  const [foldersByTeacher, setFoldersByTeacher] =
    useState<Record<string, StoryflowFolder[]>>(initialFoldersByTeacher);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);

  useEffect(() => {
    primeStudentStoryflowAssignments(session.username, initialTaskCards);
    Object.entries(initialDocumentsByTeacher).forEach(([teacherUsername, documents]) => {
      primeAccessibleTeacherStoryflowDocuments(teacherUsername, documents);
    });
    setFoldersByTeacher(initialFoldersByTeacher);
    setTaskCards(buildTaskCards(getStudentStoryflowAssignments(session.username)));
  }, [
    initialDocumentsByTeacher,
    initialFoldersByTeacher,
    initialTaskCards,
    session.username,
  ]);

  useEffect(() => {
    let disposed = false;

    const refreshTaskCards = () => {
      if (!disposed) {
        setTaskCards(buildTaskCards(getStudentStoryflowAssignments(session.username)));
      }
    };

    refreshTaskCards();

    void hydrateStudentStoryflowAssignments(session.username)
      .then((assignments) =>
        hydrateAccessibleStoryflowDocumentsForTeachers(
          assignments.map((item) => item.teacherUsername)
        )
      )
      .then(() => {
        refreshTaskCards();
      })
      .catch(() => {
        refreshTaskCards();
      });

    return () => {
      disposed = true;
    };
  }, [session.username]);

  const courseLevelGroups = useMemo<CourseLevelGroup[]>(() => {
    const groups = new Map<string, CourseLevelGroup>();

    taskCards.forEach((task) => {
      const folder = foldersByTeacher[task.teacherUsername]?.find(
        (item) => item.id === task.folderId
      );
      const key = `${task.teacherUsername}:${folder?.id || "root"}`;
      const current =
        groups.get(key) ||
        ({
          key,
          name: folder?.name || "未归类课程",
          teacherUsername: task.teacherUsername,
          folder,
          tasks: [],
          coverImageUrl: "",
          latestStudiedAt: 0,
          sortOrder: folder?.sortOrder || folder?.createdAt || 0,
        } satisfies CourseLevelGroup);

      current.tasks.push(task);
      current.latestStudiedAt = Math.max(current.latestStudiedAt, task.lastStudiedAt || 0);
      groups.set(key, current);
    });

    return Array.from(groups.values())
      .map((group) => {
        const sortedTasks = [...group.tasks].sort((left, right) => {
          const orderDiff = right.documentSortOrder - left.documentSortOrder;
          if (orderDiff !== 0) return orderDiff;
          return right.createdAt - left.createdAt;
        });
        return {
          ...group,
          tasks: sortedTasks,
          coverImageUrl: getFolderCoverImageUrl(group.folder, sortedTasks),
        };
      })
      .sort((left, right) => {
        const orderDiff = right.sortOrder - left.sortOrder;
        if (orderDiff !== 0) return orderDiff;
        return left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      });
  }, [foldersByTeacher, taskCards]);

  const renderCoverFrame = ({
    imageUrl,
    title,
    alt,
    badge,
    meta,
    fallback,
  }: {
    imageUrl: string;
    title: string;
    alt: string;
    badge: string;
    meta: string;
    fallback: string;
  }) => (
      <div className="relative aspect-[3/4] overflow-hidden rounded-[1.35rem] bg-slate-100">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={alt}
            className="h-full w-full object-cover object-center"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-[linear-gradient(180deg,#e0f2fe_0%,#f8fbff_100%)]">
            <span className="rounded-full bg-white/80 px-4 py-2 text-sm font-bold text-sky-700 shadow-sm">
              {fallback}
            </span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/75 via-slate-900/18 to-transparent px-4 pb-4 pt-12">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-bold text-sky-700 backdrop-blur">
              {badge}
            </span>
            <span className="text-xs font-medium text-white/90">
              {meta}
            </span>
          </div>
          <h3 className="mt-3 text-[1.9rem] font-black leading-tight text-white">
            {title}
          </h3>
        </div>
      </div>
  );

  const renderCourseCardShell = ({
    cardKey,
    href,
    onClick,
    cover,
    detailText,
    actionText,
  }: CourseCardShellArgs) => {
    const className =
      "overflow-hidden rounded-[1.8rem] border border-sky-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_18px_50px_rgba(56,189,248,0.12)]";
    const content = (
      <>
        {cover}
        <p className="mt-4 text-sm leading-6 text-slate-500">{detailText}</p>
        <div className="mt-5 inline-flex rounded-full bg-sky-600 px-4 py-2 text-sm font-bold text-white">
          {actionText}
        </div>
      </>
    );

    if (href) {
      return (
        <Link key={cardKey} href={href} className={className}>
          {content}
        </Link>
      );
    }

    return (
      <button
        key={cardKey}
        type="button"
        onClick={onClick}
        className={`${className} text-left`}
      >
        {content}
      </button>
    );
  };

  const renderTaskCard = (task: StudentTaskCard) =>
    renderCourseCardShell({
      cardKey: task.id,
      href: `/tasks/${task.id}`,
      cover: renderCoverFrame({
        imageUrl: task.coverImageUrl,
        title: task.documentTitle,
        alt: task.documentTitle,
        badge: task.lastStudiedAt > 0 ? "上次学过" : "图文导学",
        meta: formatDate(task.createdAt),
        fallback: "牛津树绘本",
      }),
      detailText: <>发布老师：{task.teacherDisplayName}</>,
      actionText: task.lastStudiedAt > 0 ? "继续学习" : "开始练习",
    });

  const renderFolderIcon = (group: CourseLevelGroup) => (
    <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-[1.2rem] bg-sky-100 text-sm font-black text-sky-700">
      {group.coverImageUrl ? (
        <img
          src={group.coverImageUrl}
          alt={group.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <span>Level</span>
      )}
    </div>
  );

  const renderFolderHeader = (group: CourseLevelGroup, showEnterButton: boolean) => (
    <div className="flex flex-wrap items-center gap-4">
      {renderFolderIcon(group)}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-black text-slate-900">{group.name}</h2>
          {group.latestStudiedAt > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-700">
              上次学过
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          {group.tasks.length} 本绘本
          {group.latestStudiedAt > 0
            ? ` · 最近学习 ${formatDate(group.latestStudiedAt)}`
            : ""}
        </p>
      </div>
      {showEnterButton ? (
        <button
          type="button"
          onClick={() => setSelectedGroupKey(group.key)}
          className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-sky-500"
        >
          进入
        </button>
      ) : null}
    </div>
  );

  const renderFolderDetail = (group: CourseLevelGroup) => (
    <section className="mt-6 rounded-[1.8rem] border border-sky-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {renderFolderHeader(group, false)}
        <button
          type="button"
          onClick={() => setSelectedGroupKey(null)}
          className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-200"
        >
          返回分类
        </button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {group.tasks.map((task) => renderTaskCard(task))}
      </div>
    </section>
  );

  const renderFolderCoverMode = () => {
    const selectedGroup = courseLevelGroups.find((group) => group.key === selectedGroupKey);
    if (selectedGroup) return renderFolderDetail(selectedGroup);

    return (
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {courseLevelGroups.map((group) =>
          renderCourseCardShell({
            cardKey: group.key,
            onClick: () => setSelectedGroupKey(group.key),
            cover: renderCoverFrame({
              imageUrl: group.coverImageUrl,
              title: group.name,
              alt: group.name,
              badge: group.latestStudiedAt > 0 ? "上次学过" : "图文导学",
              meta: `${group.tasks.length} 本绘本`,
              fallback: "牛津树绘本",
            }),
            detailText: <>共 {group.tasks.length} 本绘本</>,
            actionText: "进入学习",
          })
        )}
      </div>
    );
  };

  const renderFolderPreviewMode = () => {
    const selectedGroup = courseLevelGroups.find((group) => group.key === selectedGroupKey);
    if (selectedGroup) return renderFolderDetail(selectedGroup);

    return (
      <div className="mt-6 space-y-6">
        {courseLevelGroups.map((group) => (
          <section
            key={group.key}
            className="rounded-[1.8rem] border border-sky-100 bg-white p-4 shadow-sm"
          >
            {renderFolderHeader(group, true)}
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.tasks.slice(0, 3).map((task) => renderTaskCard(task))}
            </div>
          </section>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 md:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[1.8rem] bg-white px-5 py-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-500">
              任务入口
            </p>
            <h1 className="mt-2 text-3xl font-black text-slate-900">牛津树绘本任务</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              老师发布给你的牛津树绘本练习会按课程级别整理在这里。上次学过的课程会显示继续学习。
            </p>
          </div>
          <Link
            href="/"
            className="rounded-full bg-sky-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-500"
          >
            返回首页
          </Link>
        </div>

        {courseLevelGroups.length ? (
          initialDisplayMode === "folderCovers"
            ? renderFolderCoverMode()
            : renderFolderPreviewMode()
        ) : (
          <div className="mt-6 grid min-h-[320px] place-items-center rounded-[1.8rem] bg-white p-8 text-center shadow-sm">
            <div>
              <p className="text-2xl font-black text-slate-900">还没有收到任务</p>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                等老师发布牛津树绘本任务后，这里会自动显示。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
