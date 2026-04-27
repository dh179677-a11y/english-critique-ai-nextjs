"use client";

import { useParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import TeacherShell from "@/components/teacher/TeacherShell";
import ScoreChart from "@/components/ScoreChart";
import {
  getSessionProfile,
  getStudentById,
  getStudentStatusLabel,
  type AppUser,
  type SessionUser,
} from "@/lib/clientAuth";
import {
  getUserRecords,
  type UserAnalysisRecord,
} from "@/lib/clientRecords";

const formatDateTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function TeacherStudentDetailContent() {
  const params = useParams<{ id: string }>();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [student, setStudent] = useState<AppUser | null>(null);
  const [records, setRecords] = useState<UserAnalysisRecord[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [videoError, setVideoError] = useState("");

  useEffect(() => {
    const current = getSessionProfile();
    if (!current) return;

    const id = params?.id;
    if (!id || typeof id !== "string") return;

    const currentStudent = getStudentById(current.username, id);
    setSession(current);
    setStudent(currentStudent);

    if (currentStudent) {
      const list = getUserRecords(currentStudent.username);
      setRecords(list);
      setSelectedRecordId(list[0]?.id || null);
    }
  }, [params]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) || records[0] || null,
    [records, selectedRecordId]
  );

  useEffect(() => {
    const objectKey = selectedRecord?.videoObjectKey;

    if (!objectKey) {
      setVideoUrl("");
      setVideoError(selectedRecord ? "这条旧记录没有保存视频对象，当前只能查看点评。" : "");
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
  }, [selectedRecord]);

  if (!session) {
    return null;
  }

  if (!student) {
    return (
      <TeacherShell
        session={session}
        title="学员详情"
        subtitle="未找到对应学员，或该学员不属于当前老师。"
        backHref="/teacher/students"
      >
        <div className="rounded-[1.8rem] bg-white p-8 text-center text-slate-500">
          学员不存在，或当前老师没有权限查看。
        </div>
      </TeacherShell>
    );
  }

  return (
    <TeacherShell
      session={session}
      title={`${student.displayName} 的上传记录`}
      subtitle="老师可以查看学生上传的视频内容，以及每次 AI 测评的详细点评。"
      backHref="/teacher/students"
    >
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section className="rounded-[1.8rem] bg-white p-5 shadow-[0_24px_60px_rgba(148,163,184,0.12)]">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-sky-100 text-2xl font-black text-sky-700">
                {student.displayName.slice(0, 1)}
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-900">
                  {student.displayName}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{student.username}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">状态</p>
                <p className="mt-2 text-xl font-black text-blue-600">
                  {getStudentStatusLabel(student)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">班级</p>
                <p className="mt-2 text-xl font-black text-slate-900">
                  {student.className || "未分班"}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">历史记录</p>
                <p className="mt-2 text-xl font-black text-slate-900">
                  {records.length}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[1.8rem] bg-white p-4 shadow-[0_24px_60px_rgba(148,163,184,0.12)]">
            <h3 className="px-2 py-2.5 text-xl font-black text-slate-900">上传记录</h3>
            <div className="space-y-3">
              {records.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-slate-500">
                  暂无上传记录。
                </div>
              ) : (
                records.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => setSelectedRecordId(record.id)}
                    className={`w-full rounded-[1.35rem] border px-4 py-3.5 text-left transition ${
                      selectedRecord?.id === record.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-100 bg-slate-50 hover:border-slate-200"
                    }`}
                  >
                    <p className="text-sm text-slate-500">
                      {formatDateTime(record.createdAt)}
                    </p>
                    <p className="mt-1.5 text-base font-black text-slate-900">
                      {record.result.bookName || "未命名内容"}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {record.result.homeworkType || "口语练习"}
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="space-y-6">
          {!selectedRecord ? (
            <div className="rounded-[1.8rem] bg-white p-8 text-center text-slate-500 shadow-[0_24px_60px_rgba(148,163,184,0.12)]">
              这个学员还没有可查看的测评记录。
            </div>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-[1fr_0.72fr]">
                <div className="overflow-hidden rounded-[1.8rem] bg-black shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
                  {videoUrl ? (
                    <video
                      key={videoUrl}
                      src={videoUrl}
                      controls
                      className="aspect-video h-full w-full object-contain"
                    />
                  ) : (
                    <div className="grid aspect-video place-items-center bg-slate-900 px-8 text-center text-sm text-slate-300">
                      {videoError || "正在加载视频..."}
                    </div>
                  )}
                </div>
                <ScoreChart data={selectedRecord.result} />
              </div>

              <div className="rounded-[1.8rem] bg-white p-5 shadow-[0_24px_60px_rgba(148,163,184,0.12)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-2xl font-black text-slate-900">
                      点评详情
                    </h3>
                    <p className="mt-2 text-sm text-slate-500">
                      上传时间：{formatDateTime(selectedRecord.createdAt)}
                    </p>
                  </div>
                  <div className="rounded-full bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600">
                    {selectedRecord.result.homeworkType || "口语练习"}
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-[1.5rem] bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">流畅度</p>
                    <p className="mt-2 text-[2rem] font-black text-slate-900">
                      {selectedRecord.result.fluency.score}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {selectedRecord.result.fluency.comment}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">发音</p>
                    <p className="mt-2 text-[2rem] font-black text-slate-900">
                      {selectedRecord.result.pronunciation.score}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {selectedRecord.result.pronunciation.comment}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">语调</p>
                    <p className="mt-2 text-[2rem] font-black text-slate-900">
                      {selectedRecord.result.intonation.score}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {selectedRecord.result.intonation.comment}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">词汇</p>
                    <p className="mt-2 text-[2rem] font-black text-slate-900">
                      {selectedRecord.result.vocabulary.score}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {selectedRecord.result.vocabulary.comment}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">情感表达</p>
                    <p className="mt-2 text-[2rem] font-black text-slate-900">
                      {selectedRecord.result.emotion.score}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {selectedRecord.result.emotion.comment}
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[1.5rem] bg-slate-50 p-5">
                    <h4 className="text-xl font-black text-slate-900">整体点评</h4>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {selectedRecord.result.overallComment}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] bg-slate-50 p-5">
                    <h4 className="text-xl font-black text-slate-900">改进建议</h4>
                    <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-600">
                      {selectedRecord.result.suggestions.map((suggestion, index) => (
                        <li key={`${selectedRecord.id}-${index}`}>• {suggestion}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {selectedRecord.result.grammarSummary ? (
                  <div className="mt-6 rounded-[1.5rem] bg-slate-50 p-5">
                    <h4 className="text-xl font-black text-slate-900">重点语法讲解</h4>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {selectedRecord.result.grammarSummary}
                    </p>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </TeacherShell>
  );
}

export default function TeacherStudentDetailPage() {
  return (
    <AuthGate allowedRoles={["teacher"]}>
      <TeacherStudentDetailContent />
    </AuthGate>
  );
}
