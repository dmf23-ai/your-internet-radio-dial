// /admin route (M23). David-only analytics dashboard.
//
// The page itself is a thin server component that just renders the client
// dashboard — all the auth-checking and data-fetching happens browser-side
// against /api/admin/metrics, which itself re-validates the bearer token
// server-side. So the real authorization gate is in the API route; this
// page's email check is a UX nicety (anyone else just sees a placeholder).

import Dashboard from "./Dashboard";

export const metadata = {
  title: "YIRD — Station Log",
  // Don't surface this page in search engines — it's an admin-only view.
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <Dashboard />;
}
