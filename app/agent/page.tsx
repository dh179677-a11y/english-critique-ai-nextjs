import AuthGate from "@/components/AuthGate";
import AgentStudyClient from "@/components/student/AgentStudyClient";

export default function AgentPage() {
  return (
    <AuthGate allowedRoles={["student"]}>
      <AgentStudyClient />
    </AuthGate>
  );
}
