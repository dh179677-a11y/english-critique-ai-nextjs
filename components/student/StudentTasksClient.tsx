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
} from "@/lib/storyflowStore";

export type StudentTaskCard = StoryflowAssignment & {
  coverObjectKey: string;
};

interface StudentTasksClientProps {
  session: SessionUser;
  initialTaskCards: StudentTaskCard[];
  initialDocumentsByTeacher: Record<string, StoryflowDocument[]>;
}

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

  if (!response.ok || !("urls" in payload)) {
    throw new Error("error" in payload ? payload.error : "任务封面加载失败");
  }

  return payload.urls;
};

const buildTaskCards = (tasks: StoryflowAssignment[]) =>
  tasks.map((task) => {
    const document = getTeacherStoryflowDocuments(task.teacherUsername).find(
      (item) => item.id === task.documentId
    );
    return {
      ...task,
      coverObjectKey:
        document?.pageObjectKeys?.[0] || document?.thumbnailObjectKey || "",
    } satisfies StudentTaskCard;
  });

export default function StudentTasksClient({
  session,
  initialTaskCards,
  initialDocumentsByTeacher,
}: StudentTasksClientProps) {
  const [taskCards, setTaskCards] = useState<StudentTaskCard[]>(initialTaskCards);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    primeStudentStoryflowAssignments(session.username, initialTaskCards);
    Object.entries(initialDocumentsByTeacher).forEach(([teacherUsername, documents]) => {
      primeAccessibleTeacherStoryflowDocuments(teacherUsername, documents);
    });
    setTaskCards(buildTaskCards(getStudentStoryflowAssignments(session.username)));
  }, [initialDocumentsByTeacher, initialTaskCards, session.username]);

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

  const coverObjectKeys = useMemo(
    () => Array.from(new Set(taskCards.map((task) => task.coverObjectKey).filter(Boolean))),
    [taskCards]
  );

  useEffect(() => {
    if (!coverObjectKeys.length) {
      setCoverUrls({});
      return;
    }

    void fetchStoryflowUrls(coverObjectKeys)
      .then((urls) => setCoverUrls(urls))
      .catch(() => setCoverUrls({}));
  }, [coverObjectKeys]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 md:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[1.8rem] bg-white px-5 py-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-500">
              任务入口
            </p>
            <h1 className="mt-2 text-3xl font-black text-slate-900">我的图文导学任务</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              老师发布给你的绘本练习会出现在这里。点击任务后会直接进入全屏练习页面。
            </p>
          </div>
          <Link
            href="/"
            className="rounded-full bg-sky-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-500"
          >
            返回首页
          </Link>
        </div>

        {taskCards.length ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {taskCards.map((task) => (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className="overflow-hidden rounded-[1.8rem] border border-sky-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_18px_50px_rgba(56,189,248,0.12)]"
              >
                <div className="relative aspect-[3/4] overflow-hidden rounded-[1.35rem] bg-slate-100">
                  {task.coverObjectKey && coverUrls[task.coverObjectKey] ? (
                    <img
                      src={coverUrls[task.coverObjectKey]}
                      alt={task.documentTitle}
                      className="h-full w-full object-cover object-center"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-[linear-gradient(180deg,#e0f2fe_0%,#f8fbff_100%)]">
                      <span className="rounded-full bg-white/80 px-4 py-2 text-sm font-bold text-sky-700 shadow-sm">
                        图文导学
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/75 via-slate-900/18 to-transparent px-4 pb-4 pt-12">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-bold text-sky-700 backdrop-blur">
                        图文导学
                      </span>
                      <span className="text-xs font-medium text-white/90">
                        {new Date(task.createdAt).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                    <h2 className="mt-3 text-[1.9rem] font-black leading-tight text-white">
                      {task.documentTitle}
                    </h2>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-6 text-slate-500">
                  发布老师：{task.teacherDisplayName}
                </p>
                <div className="mt-5 inline-flex rounded-full bg-sky-600 px-4 py-2 text-sm font-bold text-white">
                  开始练习
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-6 grid min-h-[320px] place-items-center rounded-[1.8rem] bg-white p-8 text-center shadow-sm">
            <div>
              <p className="text-2xl font-black text-slate-900">还没有收到任务</p>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                等老师发布图文导学任务后，这里会自动显示。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
