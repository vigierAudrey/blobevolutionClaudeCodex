/**
 * Auth pages route group layout
 * Organizational wrapper for auth pages (login, register, etc.)
 * Client components (AuthForm) already have "use client" directive
 * Pages default to SSG unless they opt into SSR
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
