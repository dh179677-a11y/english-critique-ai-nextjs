"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import StoryflowWorkspace from "@/components/teacher/StoryflowWorkspace";
import TeacherShell from "@/components/teacher/TeacherShell";
import { getSessionProfile, type SessionUser } from "@/lib/clientAuth";

function TeacherStoryflowContent() {
  const [session, setSession] = useState<SessionUser | null>(null);
  const searchParams = useSearchParams();
  const initialDocumentId = searchParams.get("doc");

  useEffect(() => {
    setSession(getSessionProfile());
  }, []);

  if (!session) {
    return null;
  }

  return (
    <TeacherShell
      session={session}
      title="图文导学"
      subtitle="老师上传图片或 PDF 后，自动生成故事思维导图和看图说话课堂素材。"
      backHref="/teacher"
      actions={
        <Link
          href="/teacher/storyflow/library"
          className="rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          整理资料库
        </Link>
      }
    >
      <StoryflowWorkspace session={session} initialDocumentId={initialDocumentId} />
    </TeacherShell>
  );
}

export default function TeacherStoryflowPage() {
  return (
    <AuthGate allowedRoles={["teacher"]}>
      <TeacherStoryflowContent />
    </AuthGate>
  );
}
