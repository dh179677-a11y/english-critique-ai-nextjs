"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import ScoreChart from "@/components/ScoreChart";
import TeacherShell from "@/components/teacher/TeacherShell";
import {
  getSessionProfile,
  getStudentStatusLabel,
  getTeacherClassById,
  getTeacherStudents,
  type AppUser,
  type SessionUser,
  type TeacherClass,
} from "@/lib/clientAuth";
import {
  classWorkspaceNav,
  getClassCapacityLabel,
  getClassCoverTheme,
  getClassMaterials,
  getLeaderboardMetric,
  getScheduleDays,
  type ClassWorkspaceView,
} from "@/lib/classPortal";
import {
  getUserRecords,
  type UserAnalysisRecord,
} from "@/lib/clientRecords";

type CoursePanel = "schedule" | "attendance" | "progress";
type MemberPanel = "students" | "teachers";
type MaterialPanel = "books" | "courseware" | "exercises";
type TaskPanel = "classroom" | "clockin";
type RankingPanel = "star" | "flower" | "medal" | "progress";

interface TaskEntry {
  id: string;
  student: AppUser;
  record: UserAnalysisRecord;
  score: number;
}

const formatDate = (value?: number | null) =>
  value
    ? new Date(value).toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : "-";

const formatDateTime = (value: number) =>
  new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const getTaskScore = (record: UserAnalysisRecord) =>
  Math.round(
    (record.result.fluency.score +
      record.result.pronunciation.score +
      record.result.intonation.score +
      record.result.vocabulary.score +
      record.result.emotion.score) /
      5
  );

const classViewSet = new Set<ClassWorkspaceView>(
  classWorkspaceNav.map((item) => item.id)
);

const resolveView = (value: string | null): ClassWorkspaceView =>
  value && classViewSet.has(value as ClassWorkspaceView)
    ? (value as ClassWorkspaceView)
    : "course";

const chipButtonClass =
  "rounded-full bg-white px-6 py-3 text-base font-black text-slate-800 shadow-md transition hover:bg-slate-50";

const secondaryActionClass =
  "rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 text-base font-black text-white shadow-lg shadow-sky-300/20 transition hover:translate-y-[-1px]";

function TeacherClassDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [session, setSession] = useState<SessionUser | null>(null);
  const [classInfo, setClassInfo] = useState<TeacherClass | null>(null);
  const [students, setStudents] = useState<AppUser[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoError, setVideoError] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [coursePanel, setCoursePanel] = useState<CoursePanel>("schedule");
  const [memberPanel, setMemberPanel] = useState<MemberPanel>("students");
  const [materialPanel, setMaterialPanel] = useState<MaterialPanel>("books");
  const [taskPanel, setTaskPanel] = useState<TaskPanel>("classroom");
  const [rankingPanel, setRankingPanel] = useState<RankingPanel>("star");
  const [memberKeyword, setMemberKeyword] = useState("");
  const [taskKeyword, setTaskKeyword] = useState("");
  const [materialMenuOpen, setMaterialMenuOpen] = useState(false);

  const classId = params?.id;
  const activeView = resolveView(searchParams.get("view"));

  useEffect(() => {
    const current = getSessionProfile();
    if (!current || !classId || typeof classId !== "string") return;

    setSession(current);
    setClassInfo(getTeacherClassById(current.username, classId));
    setStudents(getTeacherStudents(current.username));
  }, [classId]);

  const currentStudents = useMemo(
    () => students.filter((student) => student.classId === classInfo?.id),
    [classInfo?.id, students]
  );

  const filteredMembers = useMemo(() => {
    const query = memberKeyword.trim().toLowerCase();

    return currentStudents.filter((student) => {
      if (!query) return true;
      return (
        student.displayName.toLowerCase().includes(query) ||
        student.username.toLowerCase().includes(query)
      );
    });
  }, [currentStudents, memberKeyword]);

  const taskEntries = useMemo<TaskEntry[]>(() => {
    const entries = currentStudents.flatMap((student) =>
      getUserRecords(student.username).map((record) => ({
        id: `${student.id}_${record.id}`,
        student,
        record,
        score: getTaskScore(record),
      }))
    );

    const query = taskKeyword.trim().toLowerCase();

    return entries
      .filter((entry, index) => {
        if (taskPanel === "clockin") {
          return index % 2 === 0;
        }
        return true;
      })
      .filter((entry) => {
        if (!query) return true;
        const haystack = [
          entry.student.displayName,
          entry.student.username,
          entry.record.result.bookName || "",
          entry.record.result.homeworkType || "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) => right.record.createdAt - left.record.createdAt);
  }, [currentStudents, taskKeyword, taskPanel]);

  useEffect(() => {
    if (!taskEntries.length) {
      setSelectedTaskId(null);
      return;
    }

    if (!selectedTaskId || !taskEntries.some((item) => item.id === selectedTaskId)) {
      setSelectedTaskId(taskEntries[0].id);
    }
  }, [selectedTaskId, taskEntries]);

  const selectedTask = useMemo(
    () => taskEntries.find((entry) => entry.id === selectedTaskId) || taskEntries[0] || null,
    [selectedTaskId, taskEntries]
  );

  useEffect(() => {
    const objectKey = selectedTask?.record.videoObjectKey;

    if (!objectKey) {
      setVideoUrl("");
      setVideoError(selectedTask ? "这条记录没有保留视频对象，只能查看点评内容。" : "");
      return;
    }

    let cancelled = false;

    fetch("/api/video-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectKey }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "视频读取失败");
        }
        return response.json() as Promise<{ url?: string }>;
      })
      .then((data) => {
        if (cancelled) return;
        setVideoUrl(data.url || "");
        setVideoError(data.url ? "" : "视频地址为空");
      })
      .catch((error) => {
        if (cancelled) return;
        setVideoUrl("");
        setVideoError(error instanceof Error ? error.message : "视频读取失败");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTask]);

  const leaderboard = useMemo(() => {
    return currentStudents
      .map((student) => {
        const records = getUserRecords(student.username);

        return {
          student,
          star: getLeaderboardMetric(records.map((item) => item.result), "star"),
          flower: getLeaderboardMetric(records.map((item) => item.result), "flower"),
          medal: getLeaderboardMetric(records.map((item) => item.result), "medal"),
          progress: getLeaderboardMetric(records.map((item) => item.result), "progress"),
        };
      })
      .sort((left, right) => right[rankingPanel] - left[rankingPanel]);
  }, [currentStudents, rankingPanel]);

  const overview = useMemo(() => {
    const active = currentStudents.filter(
      (student) => getStudentStatusLabel(student) === "使用中"
    ).length;
    const expired = currentStudents.filter(
      (student) => getStudentStatusLabel(student) === "已过期"
    ).length;
    const neverLogged = currentStudents.filter((student) => !student.lastLoginAt).length;

    return { active, expired, neverLogged };
  }, [currentStudents]);

  const setView = (view: ClassWorkspaceView) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    router.replace(`/teacher/classes/${classId}?${params.toString()}`);
  };

  if (!session) {
    return null;
  }

  if (!classInfo) {
    return (
      <TeacherShell
        session={session}
        title="班级详情"
        subtitle="未找到对应班级，或该班级不属于当前老师。"
        backHref="/teacher/classes"
      >
        <div className="rounded-[1.8rem] bg-white p-8 text-center text-slate-500">
          班级不存在，或当前老师没有权限查看。
        </div>
      </TeacherShell>
    );
  }

  const theme = getClassCoverTheme(classInfo.name);
  const materials = getClassMaterials();
  const scheduleDays = getScheduleDays();

  const renderCourseView = () => {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-5 text-[2.15rem] font-black tracking-tight text-slate-900">
            {[
              { id: "schedule", label: "课表" },
              { id: "attendance", label: "点名" },
              { id: "progress", label: "进度" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setCoursePanel(item.id as CoursePanel)}
                className={`relative ${coursePanel === item.id ? "text-slate-900" : "text-slate-600"}`}
              >
                {item.label}
                {coursePanel === item.id ? (
                  <span className="absolute bottom-0 left-2 h-2 w-16 rounded-full bg-blue-200/75" />
                ) : null}
              </button>
            ))}
          </div>
          <button type="button" className={chipButtonClass}>
            排课
          </button>
        </div>

        {coursePanel === "schedule" ? (
          <section className="rounded-[2rem] bg-white/85 p-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
            <div className="flex flex-wrap items-center gap-3 rounded-[1.5rem] bg-white p-3 shadow-sm">
              <div className="rounded-[1.2rem] bg-slate-100 px-5 py-4 text-[2rem] font-black text-blue-600">
                03月
              </div>
              {scheduleDays.map((day) => (
                <div
                  key={day.id}
                  className={`rounded-[1.2rem] px-4 py-3 text-center ${
                    day.isToday ? "bg-blue-600 text-white" : "bg-white text-slate-800"
                  }`}
                >
                  <p className="text-lg font-black">{day.label}</p>
                  <p className={`mt-1 text-sm ${day.isToday ? "text-white/90" : "text-slate-500"}`}>
                    {day.courseCount}节课
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid min-h-[22rem] place-items-center rounded-[1.7rem] bg-sky-50/65 text-center text-slate-400">
              <div>
                <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-[1.6rem] bg-white text-4xl shadow-sm">
                  🗒
                </div>
                <p className="text-2xl font-black text-slate-500">暂无课程</p>
              </div>
            </div>
          </section>
        ) : null}

        {coursePanel === "attendance" ? (
          <section className="rounded-[2rem] bg-white/85 p-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
            <div className="grid grid-cols-[1.3fr_0.9fr_0.9fr] gap-4 px-4 py-3 text-2xl font-black text-slate-900">
              <div>学员</div>
              <div>今日状态</div>
              <div>备注</div>
            </div>
            <div className="space-y-3">
              {currentStudents.length === 0 ? (
                <div className="rounded-[1.6rem] bg-slate-50 px-6 py-12 text-center text-slate-500">
                  当前班级还没有学员，暂时无法点名。
                </div>
              ) : (
                currentStudents.map((student) => (
                  <div
                    key={student.id}
                    className="grid grid-cols-[1.3fr_0.9fr_0.9fr] gap-4 rounded-[1.6rem] border border-slate-100 bg-white px-4 py-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-xl font-black text-slate-500">
                        {student.displayName.slice(0, 1)}
                      </div>
                      <div>
                        <p className="text-xl font-black text-slate-900">{student.displayName}</p>
                        <p className="mt-1 text-sm text-slate-400">{student.username}</p>
                      </div>
                    </div>
                    <div className="self-center text-xl font-black text-blue-600">未开始</div>
                    <div className="self-center text-base text-slate-500">等待老师操作</div>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}

        {coursePanel === "progress" ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {currentStudents.length === 0 ? (
              <div className="col-span-full rounded-[2rem] bg-white/85 px-6 py-12 text-center text-slate-500 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
                当前班级还没有学习进度数据。
              </div>
            ) : (
              currentStudents.map((student) => {
                const recordCount = getUserRecords(student.username).length;
                const progress = Math.min(100, recordCount * 12);

                return (
                  <div
                    key={student.id}
                    className="rounded-[2rem] bg-white/85 p-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-14 w-14 place-items-center rounded-full bg-sky-100 text-xl font-black text-sky-700">
                        {student.displayName.slice(0, 1)}
                      </div>
                      <div>
                        <p className="text-2xl font-black text-slate-900">{student.displayName}</p>
                        <p className="mt-1 text-sm text-slate-400">{recordCount} 次测评</p>
                      </div>
                    </div>
                    <div className="mt-5 h-3 rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-3 text-sm text-slate-500">本阶段完成度 {progress}%</p>
                  </div>
                );
              })
            )}
          </section>
        ) : null}
      </div>
    );
  };

  const renderMembersView = () => {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-5 text-[2.15rem] font-black tracking-tight text-slate-900">
            {[
              { id: "students", label: "学员管理" },
              { id: "teachers", label: "老师管理" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMemberPanel(item.id as MemberPanel)}
                className={`relative ${memberPanel === item.id ? "text-slate-900" : "text-slate-600"}`}
              >
                {item.label}
                {memberPanel === item.id ? (
                  <span className="absolute bottom-0 left-2 h-2 w-16 rounded-full bg-blue-200/75" />
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={chipButtonClass}>
              邀请进班
            </button>
            <button type="button" className={chipButtonClass}>
              添加
            </button>
            <div className="rounded-full bg-white px-4 py-2.5 shadow-md">
              <input
                value={memberKeyword}
                onChange={(e) => setMemberKeyword(e.target.value)}
                placeholder="搜索"
                className="w-28 bg-transparent text-base font-black text-slate-800 outline-none placeholder:text-slate-400 md:w-36"
              />
            </div>
          </div>
        </div>

        {memberPanel === "students" ? (
          <section className="rounded-[2rem] bg-white/85 p-4 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
            <div className="grid grid-cols-[1.45fr_0.7fr_0.8fr_0.7fr] gap-4 px-4 py-3 text-[2rem] font-black text-slate-900">
              <div>学员</div>
              <div>类型</div>
              <div>状态</div>
              <div>操作</div>
            </div>

            <div className="space-y-3">
              {filteredMembers.length === 0 ? (
                <div className="rounded-[1.6rem] bg-slate-50 px-6 py-12 text-center text-slate-500">
                  这个班级还没有学员。
                </div>
              ) : (
                filteredMembers.map((student, index) => (
                  <div
                    key={student.id}
                    className="grid grid-cols-[1.45fr_0.7fr_0.8fr_0.7fr] gap-4 rounded-[1.6rem] border border-slate-100 bg-white px-4 py-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="text-4xl font-black text-slate-700">{index + 1}</div>
                      <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-xl font-black text-slate-500">
                        {student.displayName.slice(0, 1)}
                      </div>
                      <div>
                        <p className="text-2xl font-black text-slate-900">{student.displayName}</p>
                        <p className="mt-1 text-base text-slate-400">{student.username}</p>
                      </div>
                    </div>
                    <div className="self-center text-2xl font-black text-slate-900">正式</div>
                    <div>
                      <p className="text-2xl font-black text-blue-600">{getStudentStatusLabel(student)}</p>
                      <p className="mt-1 text-base text-slate-400">
                        {student.expiryAt ? `${formatDate(student.expiryAt)}到期` : "-"}
                      </p>
                    </div>
                    <div className="self-center text-right">
                      <button
                        type="button"
                        className="rounded-full bg-slate-50 px-4 py-2 text-base font-bold text-slate-700"
                      >
                        更多
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 px-4 text-[1.85rem] font-black text-slate-400">
              在读：{overview.active} ｜ 未登录：{overview.neverLogged} ｜ 已过期：{overview.expired}
            </div>
          </section>
        ) : (
          <section className="rounded-[2rem] bg-white/85 p-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
            <div className="rounded-[1.6rem] border border-slate-100 bg-white px-5 py-5">
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 overflow-hidden rounded-full border-4 border-sky-100">
                  <img
                    src="/pixel-logo.png"
                    alt="teacher avatar"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <p className="text-[2rem] font-black text-slate-900">{session.displayName}</p>
                  <p className="mt-1 text-base text-slate-400">{session.username}</p>
                  <p className="mt-2 text-lg font-semibold text-blue-600">主讲老师</p>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    );
  };

  const renderMaterialsView = () => {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-5 text-[2.15rem] font-black tracking-tight text-slate-900">
            {[
              { id: "books", label: "课本" },
              { id: "courseware", label: "课件" },
              { id: "exercises", label: "习题" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMaterialPanel(item.id as MaterialPanel)}
                className={`relative ${materialPanel === item.id ? "text-slate-900" : "text-slate-600"}`}
              >
                {item.label}
                {materialPanel === item.id ? (
                  <span className="absolute bottom-0 left-2 h-2 w-16 rounded-full bg-blue-200/75" />
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMaterialMenuOpen((current) => !current)}
                className={chipButtonClass}
              >
                管理
              </button>
              {materialMenuOpen ? (
                <div className="absolute right-0 top-16 z-10 w-64 overflow-hidden rounded-[1.8rem] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.14)]">
                  {["新建文件夹", "添加", "移动", "排序", "删除"].map((item) => (
                    <div
                      key={item}
                      className="border-b border-slate-100 px-8 py-6 text-center text-[2rem] font-medium text-slate-800 last:border-b-0"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="rounded-full bg-white px-4 py-2.5 shadow-md">
              <input
                placeholder="搜索"
                className="w-28 bg-transparent text-base font-black text-slate-800 outline-none placeholder:text-slate-400 md:w-36"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {materials.map((item) => (
            <article
              key={`${materialPanel}-${item.id}`}
              className="rounded-[2rem] bg-white/85 p-4 shadow-[0_24px_70px_rgba(148,163,184,0.12)]"
            >
              <div className={`rounded-[1.6rem] bg-gradient-to-br ${item.colorClass} p-4`}>
                <div className="flex items-center justify-between text-white">
                  <span className="rounded-lg bg-white/18 px-2 py-1 text-base font-black">
                    {item.stageLabel}
                  </span>
                  <span className="text-lg font-black">{item.lessonCount}</span>
                </div>
                <div className="mt-6 grid h-28 place-items-center rounded-[1.3rem] bg-white/20 text-center text-sm font-semibold text-white/95">
                  可测评
                </div>
              </div>
              <p className="mt-4 text-center text-[2rem] font-black text-slate-900">{item.title}</p>
            </article>
          ))}
        </div>
      </div>
    );
  };

  const renderTasksView = () => {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-5 text-[2.15rem] font-black tracking-tight text-slate-900">
            {[
              { id: "classroom", label: "课堂任务" },
              { id: "clockin", label: "打卡" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTaskPanel(item.id as TaskPanel)}
                className={`relative ${taskPanel === item.id ? "text-slate-900" : "text-slate-600"}`}
              >
                {item.label}
                {taskPanel === item.id ? (
                  <span className="absolute bottom-0 left-2 h-2 w-16 rounded-full bg-blue-200/75" />
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={chipButtonClass}>
              今
            </button>
            <div className="rounded-full bg-white px-4 py-2.5 shadow-md">
              <input
                value={taskKeyword}
                onChange={(e) => setTaskKeyword(e.target.value)}
                placeholder="搜索"
                className="w-28 bg-transparent text-base font-black text-slate-800 outline-none placeholder:text-slate-400 md:w-36"
              />
            </div>
            <button type="button" className={secondaryActionClass}>
              布置
            </button>
            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-base font-black text-white shadow-lg shadow-sky-300/20"
            >
              AI助手
            </button>
          </div>
        </div>

        {taskEntries.length === 0 ? (
          <div className="rounded-[2rem] bg-white/85 px-6 py-16 text-center text-slate-500 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
            当前班级还没有任务记录。学生提交视频测评后，这里会自动汇总视频和点评。
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_430px]">
            <section className="rounded-[2rem] bg-white/85 p-4 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
              <div className="grid grid-cols-[1.4fr_0.6fr_0.45fr] gap-4 px-4 py-3 text-[2rem] font-black text-slate-900">
                <div>任务名称</div>
                <div>状态</div>
                <div>操作</div>
              </div>
              <div className="space-y-3">
                {taskEntries.map((entry, index) => {
                  const material = materials[index % materials.length];
                  const isActive = selectedTask?.id === entry.id;

                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setSelectedTaskId(entry.id)}
                      className={`grid w-full grid-cols-[1.4fr_0.6fr_0.45fr] gap-4 rounded-[1.6rem] border px-4 py-4 text-left transition ${
                        isActive
                          ? "border-blue-500 bg-blue-50/80"
                          : "border-slate-100 bg-white hover:border-slate-200"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`w-40 rounded-[1.2rem] bg-gradient-to-br ${material.colorClass} p-3`}>
                          <div className="rounded-lg bg-white/18 px-2 py-1 text-xs font-black text-white">
                            {material.stageLabel}
                          </div>
                          <p className="mt-6 text-sm font-semibold text-white/95">
                            {material.lessonCount}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[1.9rem] font-black text-slate-900">
                            {entry.record.result.bookName || "未命名内容"} |{" "}
                            {entry.record.result.homeworkType || "口语测评"}
                          </p>
                          <p className="mt-2 text-base text-slate-500">
                            学员：{entry.student.displayName}
                          </p>
                          <p className="mt-2 text-base text-slate-500">
                            任务时间：{formatDate(entry.record.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="self-center text-[2rem] font-black text-blue-600">
                        已提交
                      </div>
                      <div className="self-center text-right">
                        <span className="inline-flex rounded-full bg-slate-50 px-4 py-2 text-base font-bold text-slate-700">
                          更多
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <aside className="space-y-5">
              {selectedTask ? (
                <>
                  <section className="rounded-[2rem] bg-white/90 p-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
                    <div className="flex items-center gap-3">
                      <div className="grid h-14 w-14 place-items-center rounded-full bg-sky-100 text-xl font-black text-sky-700">
                        {selectedTask.student.displayName.slice(0, 1)}
                      </div>
                      <div>
                        <p className="text-2xl font-black text-slate-900">
                          {selectedTask.student.displayName}
                        </p>
                        <p className="mt-1 text-sm text-slate-400">
                          上传于 {formatDateTime(selectedTask.record.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-[1.3rem] bg-slate-50 p-4">
                        <p className="text-sm text-slate-500">综合得分</p>
                        <p className="mt-2 text-[2rem] font-black text-slate-900">
                          {selectedTask.score}
                        </p>
                      </div>
                      <div className="rounded-[1.3rem] bg-slate-50 p-4">
                        <p className="text-sm text-slate-500">任务状态</p>
                        <p className="mt-2 text-[2rem] font-black text-blue-600">已提交</p>
                      </div>
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-[2rem] bg-black shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
                    {videoUrl ? (
                      <video
                        key={videoUrl}
                        src={videoUrl}
                        controls
                        className="aspect-video h-full w-full object-contain"
                      />
                    ) : (
                      <div className="grid aspect-video place-items-center bg-slate-900 px-6 text-center text-sm text-slate-300">
                        {videoError || "正在加载视频..."}
                      </div>
                    )}
                  </section>

                  <ScoreChart data={selectedTask.record.result} />

                  <section className="rounded-[2rem] bg-white/90 p-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
                    <h3 className="text-2xl font-black text-slate-900">点评内容</h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {selectedTask.record.result.overallComment}
                    </p>

                    <div className="mt-5 grid gap-3">
                      {selectedTask.record.result.suggestions.map((item, index) => (
                        <div
                          key={`${selectedTask.id}-${index}`}
                          className="rounded-[1.3rem] bg-slate-50 px-4 py-3 text-sm text-slate-600"
                        >
                          {item}
                        </div>
                      ))}
                    </div>

                    {selectedTask.record.result.grammarSummary ? (
                      <div className="mt-5 rounded-[1.3rem] bg-slate-50 p-4">
                        <p className="text-sm font-bold text-slate-900">重点语法</p>
                        <p className="mt-2 text-sm leading-7 text-slate-600">
                          {selectedTask.record.result.grammarSummary}
                        </p>
                      </div>
                    ) : null}
                  </section>
                </>
              ) : null}
            </aside>
          </div>
        )}
      </div>
    );
  };

  const renderRankingView = () => {
    const titleMap: Record<RankingPanel, string> = {
      star: "星星榜",
      flower: "红花榜",
      medal: "奖章榜",
      progress: "完成度",
    };

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-5 text-[2.15rem] font-black tracking-tight text-slate-900">
            {(
              [
                { id: "star", label: "星星榜" },
                { id: "flower", label: "红花榜" },
                { id: "medal", label: "奖章榜" },
                { id: "progress", label: "完成度" },
              ] as { id: RankingPanel; label: string }[]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setRankingPanel(item.id)}
                className={`relative ${rankingPanel === item.id ? "text-slate-900" : "text-slate-600"}`}
              >
                {item.label}
                {rankingPanel === item.id ? (
                  <span className="absolute bottom-0 left-2 h-2 w-16 rounded-full bg-blue-200/75" />
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={chipButtonClass}>
              本月
            </button>
            <button type="button" className={chipButtonClass}>
              分享
            </button>
          </div>
        </div>

        <section className="space-y-3">
          {leaderboard.length === 0 ? (
            <div className="rounded-[2rem] bg-white/85 px-6 py-16 text-center text-slate-500 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
              当前班级还没有足够的数据生成 {titleMap[rankingPanel]}。
            </div>
          ) : (
            leaderboard.map((item, index) => (
              <div
                key={`${rankingPanel}-${item.student.id}`}
                className="grid grid-cols-[0.35fr_1.4fr_0.8fr_0.45fr] items-center gap-4 rounded-[2rem] bg-white/85 px-5 py-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)]"
              >
                <div className="text-center text-[2.5rem] font-black text-slate-700">
                  {index + 1}
                </div>
                <div className="flex items-center gap-4">
                  <div className="grid h-20 w-20 place-items-center rounded-full bg-slate-100 text-2xl font-black text-slate-500">
                    {item.student.displayName.slice(0, 1)}
                  </div>
                  <p className="text-[2rem] font-black text-slate-900">
                    {item.student.displayName}
                  </p>
                </div>
                <div className="text-right text-[2rem] font-black text-slate-900">
                  ⭐ {item[rankingPanel]}
                </div>
                <div className="text-center text-lg font-bold text-slate-700">
                  分享
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    );
  };

  const renderActivityView = () => {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[2.15rem] font-black tracking-tight text-slate-900">动态</div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={chipButtonClass}>
              微官网
            </button>
            <button type="button" className={chipButtonClass}>
              创建
            </button>
          </div>
        </div>
        <section className="grid min-h-[36rem] place-items-center rounded-[2rem] bg-white/65 text-center shadow-[0_24px_70px_rgba(148,163,184,0.1)]">
          <div>
            <div className="mx-auto mb-4 grid h-24 w-24 place-items-center rounded-[1.8rem] bg-white text-5xl shadow-sm">
              🗂
            </div>
            <p className="text-[2.2rem] font-black text-slate-500">
              在这里分享班级的精彩动态吧
            </p>
          </div>
        </section>
      </div>
    );
  };

  return (
    <TeacherShell
      session={session}
      title="班级详情"
      subtitle="进入班级后统一查看课程、成员、教材、任务、排行榜和动态内容。"
      backHref="/teacher/classes"
    >
      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section className="overflow-hidden rounded-[2rem] bg-white/90 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
            <div className={`relative overflow-hidden rounded-b-[2rem] ${theme.coverClass}`}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.24),_transparent_42%)]" />
              <div className="flex items-center gap-4 px-5 py-5">
                <div className="h-24 w-24 overflow-hidden rounded-[1.5rem] border border-white/30 bg-white/15 p-1 backdrop-blur-sm">
                  <img
                    src="/pixel-logo.png"
                    alt="class cover"
                    className="h-full w-full rounded-[1.2rem] object-cover"
                  />
                </div>
                <div className="min-w-0 text-white">
                  <p className="line-clamp-2 text-[2rem] font-black leading-tight">
                    {classInfo.name}
                  </p>
                  <p className="mt-2 text-lg text-white/90">{session.displayName}</p>
                  <div className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${theme.chipClass}`}>
                    {getClassCapacityLabel(currentStudents.length)}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 px-5 py-5">
              <div className="flex items-center justify-between text-[1.9rem] text-slate-700">
                <span>课程：</span>
                <span className="font-black text-blue-600">自然拼读长读营</span>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                <div className="rounded-[1.4rem] bg-slate-50 px-4 py-4 text-center">
                  <p className="text-3xl font-black text-slate-900">{currentStudents.length}</p>
                  <p className="mt-1 text-sm text-slate-500">班级学员</p>
                </div>
                <div className="rounded-[1.4rem] bg-slate-50 px-4 py-4 text-center">
                  <p className="text-3xl font-black text-slate-900">{taskEntries.length}</p>
                  <p className="mt-1 text-sm text-slate-500">任务记录</p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] bg-white/90 p-4 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
            <div className="grid grid-cols-2 gap-3">
              {classWorkspaceNav.map((item) => {
                const active = activeView === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    className={`rounded-[1.7rem] px-4 py-5 text-center transition ${
                      active
                        ? "bg-blue-100 text-slate-900 shadow-inner"
                        : "bg-white text-slate-800 hover:bg-slate-50"
                    }`}
                  >
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-[1rem] bg-gradient-to-br from-sky-500 to-blue-600 text-xl font-black text-white shadow-lg shadow-sky-300/20">
                      {item.badge}
                    </div>
                    <p className="mt-4 text-[1.9rem] font-black">{item.label}</p>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        <section>
          {activeView === "course" ? renderCourseView() : null}
          {activeView === "members" ? renderMembersView() : null}
          {activeView === "materials" ? renderMaterialsView() : null}
          {activeView === "tasks" ? renderTasksView() : null}
          {activeView === "ranking" ? renderRankingView() : null}
          {activeView === "activity" ? renderActivityView() : null}
        </section>
      </div>
    </TeacherShell>
  );
}

export default function TeacherClassDetailPage() {
  return (
    <AuthGate allowedRoles={["teacher"]}>
      <TeacherClassDetailContent />
    </AuthGate>
  );
}
