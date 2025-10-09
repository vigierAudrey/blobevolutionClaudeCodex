/**
 * Static pages route group layout
 * Wraps static pages WITHOUT ClientProvider to enable SSG
 * These pages don't need auth/contexts
 */
export default function StaticLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Intentionally does NOT include ClientProvider
  // Static pages should not use contexts
  return <>{children}</>;
}
