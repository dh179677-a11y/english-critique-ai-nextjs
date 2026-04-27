import App from "@/App";
import AuthGate from "@/components/AuthGate";

export default function HomePage() {
  return (
    <AuthGate allowedRoles={["student"]}>
      <App mode="dashboard" />
    </AuthGate>
  );
}
