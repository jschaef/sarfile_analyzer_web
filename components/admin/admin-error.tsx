import { ShieldAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiError } from "@/lib/api";

// 403 from the API: the page is for admins only.
export function AdminError({ error }: { error: unknown }) {
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <Alert variant="destructive" data-testid="admin-error">
      <ShieldAlertIcon />
      <AlertTitle>{forbidden ? "Admins only" : "Request failed"}</AlertTitle>
      <AlertDescription>
        {forbidden ? "This page needs the admin role." : error instanceof Error ? error.message : String(error)}
      </AlertDescription>
    </Alert>
  );
}
