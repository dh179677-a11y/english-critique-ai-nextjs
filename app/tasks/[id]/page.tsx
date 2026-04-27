"use client";

import React, { useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import StoryflowTaskPlayer from "@/components/student/StoryflowTaskPlayer";
import { getSessionProfile, type SessionUser } from "@/lib/clientAuth";

function StudentTaskDetailContent({ assignmentId }: { assignmentId: string }) {
  const [session, setSession] = useState<SessionUser | null>(null);

  useEffect(() => {
    setSession(getSessionProfile());
  }, []);

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
