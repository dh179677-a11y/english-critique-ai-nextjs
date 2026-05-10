"use client";

import React from "react";
import AuthGate from "@/components/AuthGate";
import StoryflowTaskPlayer from "@/components/student/StoryflowTaskPlayer";
import { useSessionProfile } from "@/lib/useSessionProfile";

function StudentTaskDetailContent({ assignmentId }: { assignmentId: string }) {
  const session = useSessionProfile();

  if (!session) return null;

  return <StoryflowTaskPlayer assignmentId={assignmentId} session={session} view="overview" />;
}

export default function StudentTaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);

  return (
    <AuthGate allowedRoles={["student"]}>
      <StudentTaskDetailContent assignmentId={id} />
    </AuthGate>
  );
}
