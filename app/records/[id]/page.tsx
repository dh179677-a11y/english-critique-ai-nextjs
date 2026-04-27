"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import { clearSessionUser, getSessionProfile } from "@/lib/clientAuth";
import {
  getUserRecordById,
  updateUserRecord,
  type UserAnalysisRecord,
} from "@/lib/clientRecords";
import ScoreChart from "@/components/ScoreChart";
import FeedbackSection from "@/components/FeedbackSection";
import type { AnalysisResult } from "@/types";
import type { VideoMetadata } from "@/services/geminiService";

function RecordDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [username, setUsername] = useState("");
  const [record, setRecord] = useState<UserAnalysisRecord | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const current = getSessionProfile();
    if (!current) {
      router.replace("/login");
      return;
    }

    const id = params?.id;
    if (!id || typeof id !== "string") {
      setReady(true);
      return;
    }

    setUsername(current.username);
    setRecord(getUserRecordById(current.username, id));
    setReady(true);
  }, [params, router]);

  const handleLogout = () => {
    clearSessionUser();
    router.replace("/login");
  };

  const getMetadata = (r: AnalysisResult): VideoMetadata => ({
    studentName: r.studentName,
    bookName: r.bookName,
    homeworkType: r.homeworkType,
    tutorName: r.tutorName,
  });

  const handleDetailDataChange = (newData: AnalysisResult) => {
    if (!record) return;

    setRecord({ ...record, result: newData });
    updateUserRecord(username, record.id, newData);
  };

  if (!ready) {
    return <div className="min-h-screen bg-gray-100" />;
  }

  if (!record) {
    return (
      <div className="min-h-screen bg-gray-100 pb-10">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-[72rem] mx-auto px-4 py-3.5 flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="h-12 w-12 rounded-xl overflow-hidden">
                <img src="/pixel-logo.png" alt="EnglishPro logo" className="h-full w-full object-cover" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">EnglishPro Critique AI</h1>
                <p className="text-xs text-gray-500">智能口语测评助手</p>
              </div>
            </div>
            <div className="flex items-center gap-5 text-slate-700 font-semibold">
              <Link href="/records" className="hover:text-blue-600">返回记录</Link>
              <Link href="/" className="hover:text-blue-600">上传新视频</Link>
              <button onClick={handleLogout} className="hover:text-blue-600">退出登录</button>
            </div>
          </div>
        </header>
        <main className="max-w-[72rem] mx-auto px-4 py-8">
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-gray-600">
            记录不存在或无权限查看。
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-10">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[72rem] mx-auto px-4 py-3.5 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="h-12 w-12 rounded-xl overflow-hidden">
              <img src="/pixel-logo.png" alt="EnglishPro logo" className="h-full w-full object-cover" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">EnglishPro Critique AI</h1>
              <p className="text-xs text-gray-500">智能口语测评助手</p>
            </div>
          </div>
          <div className="flex items-center gap-5 text-slate-700 font-semibold">
            <Link href="/records" className="hover:text-blue-600">返回记录</Link>
            <Link href="/" className="hover:text-blue-600">上传新视频</Link>
            <button onClick={handleLogout} className="hover:text-blue-600">退出登录</button>
          </div>
        </div>
      </header>

      <main className="max-w-[72rem] mx-auto px-4 py-8">
        <div className="mb-5">
          <h2 className="text-[2rem] font-extrabold text-slate-900">测评详情</h2>
          <p className="mt-2 text-sm text-slate-600">
            学生：{record.result.studentName || "未填写"} · 绘本：{record.result.bookName || "未命名绘本"}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.382fr_0.618fr]">
          <div className="lg:col-span-1 space-y-6">
            <ScoreChart data={record.result} />
          </div>
          <div className="lg:col-span-2">
            <FeedbackSection
              data={record.result}
              onDataChange={handleDetailDataChange}
              videoObjectKey={record.videoObjectKey || null}
              metadata={getMetadata(record.result)}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default function RecordDetailPage() {
  return (
    <AuthGate allowedRoles={["student"]}>
      <RecordDetailContent />
    </AuthGate>
  );
}
