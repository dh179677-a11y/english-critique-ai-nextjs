"use client";

import React from "react";
import AuthGate from "@/components/AuthGate";
import StoryflowTaskPlayer from "@/components/student/StoryflowTaskPlayer";
import { useSessionProfile } from "@/lib/clientAuth";

const ALLOWED_TASK_MODES = new Set([
  "mindmap",
  "shadow",
  "speaking",
  "performance",
  "assessment",
] as const);

type AllowedTaskMode = "mindmap" | "shadow" | "speaking" | "performance" | "assessment";

function StudentTaskModeContent({
  assignmentId,
  mode,
}: {
  assignmentId: string;
  mode: AllowedTaskMode;
}) {
  const session = useSessionProfile();

  if (!session) return null;

  return (
    <StoryflowTaskPlayer
      assignmentId={assignmentId}
      session={session}
      view="task"
      taskMode={mode}
    />
  );
}

export default function StudentTaskModePage({
  params,
}: {
  params: Promise<{ id: string; mode: string }>;
}) {
  const { id, mode } = React.use(params);

  if (!ALLOWED_TASK_MODES.has(mode as AllowedTaskMode)) {
    return (
      <AuthGate allowedRoles={["student"]}>
        <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center text-slate-500">
          未找到这个任务页面。
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate allowedRoles={["student"]}>
      <StudentTaskModeContent assignmentId={id} mode={mode as AllowedTaskMode} />
    </AuthGate>
  );
}
