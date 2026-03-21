"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import { clearSessionUser, getSessionUser } from "@/lib/clientAuth";
import {
  getUserRecords,
  type UserAnalysisRecord,
} from "@/lib/clientRecords";
import type { AnalysisResult } from "@/types";

const formatDateTime = (ts: number) =>
  new Date(ts).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function RecordsContent() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [records, setRecords] = useState<UserAnalysisRecord[]>([]);

  useEffect(() => {
    const current = getSessionUser();
    if (!current) {
      router.replace("/login");
      return;
    }

    setUsername(current);
    const list = getUserRecords(current);
    setRecords(list);
  }, [router]);

  const headerText = useMemo(() => {
    if (!username) return "我的测评记录";
    return `${username} 的测评记录`;
  }, [username]);

  const handleLogout = () => {
    clearSessionUser();
    router.replace("/login");
  };

  const getSummaryScore = (r: AnalysisResult) => {
    const total =
      r.fluency.score +
      r.pronunciation.score +
      r.intonation.score +
      r.vocabulary.score +
      r.emotion.score;
    return Math.round(total / 5);
  };

  return (
    <div className="min-h-screen bg-gray-100 pb-12">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="h-12 w-12 rounded-xl overflow-hidden">
              <img src="/pixel-logo.png" alt="EnglishPro logo" className="h-full w-full object-cover" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">EnglishPro Critique AI</h1>
              <p className="text-xs text-gray-500">智能口语测评助手</p>
            </div>
          </div>
          <div className="flex items-center gap-5 text-slate-700 font-semibold">
            <Link href="/" className="hover:text-blue-600">返回测评</Link>
            <button onClick={handleLogout} className="hover:text-blue-600">退出登录</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h2 className="text-3xl font-extrabold text-slate-900 mb-2">我的测评记录</h2>
            <p className="text-base text-slate-600">查看您过去所有的口语测评报告</p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center px-5 py-3 rounded-xl border border-gray-300 bg-white text-slate-700 font-semibold hover:bg-gray-50"
          >
            ← 返回测评 (Back)
          </Link>
        </div>

        {records.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-gray-600">
            暂无测评记录。先去上传视频完成一次分析。
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6">
              {records.map((record) => {
                const r = record.result;
                const score = getSummaryScore(r);
                return (
                  <div
                    key={record.id}
                    className="w-full max-w-[80%] mx-auto bg-white rounded-2xl border p-4 shadow-sm border-gray-200 min-h-[175px] flex flex-col"
                  >
                    <div className="inline-flex px-2.5 py-1 rounded-full text-blue-600 bg-blue-50 text-xs font-semibold mb-3">
                      {r.homeworkType || "口语练习"}
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-3">
                      {r.bookName?.trim() || "未命名绘本"}
                    </h3>
                    <div className="space-y-1.5 text-slate-600 mb-4">
                      <p className="text-xs">学生: <span className="font-semibold text-slate-800">{r.studentName || "未填写"}</span></p>
                      <p className="text-xs">时间: {formatDateTime(record.createdAt)}</p>
                    </div>
                    <div className="pt-3 border-t border-gray-100 flex items-end justify-between mt-auto">
                      <div>
                        <p className="text-blue-600 text-4xl font-extrabold leading-none">{score}<span className="text-base text-gray-500"> / 100</span></p>
                        <p className="text-gray-500 text-xs mt-1">综合得分</p>
                      </div>
                      <Link
                        href={`/records/${record.id}`}
                        className="text-blue-600 text-sm font-semibold hover:text-blue-700"
                      >
                        查看详情 ›
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function RecordsPage() {
  return (
    <AuthGate>
      <RecordsContent />
    </AuthGate>
  );
}
