import App from "@/App";
import AuthGate from "@/components/AuthGate";

export default function UploadPage() {
  return (
    <AuthGate allowedRoles={["student"]}>
      <App mode="upload" />
    </AuthGate>
  );
}
