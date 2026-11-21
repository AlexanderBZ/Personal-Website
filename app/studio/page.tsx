import type { Metadata } from "next";
import FreewriteAdmin from "@/components/FreewriteAdmin";
import { isAdminAuthenticated } from "@/lib/auth";
import { getAllAdminPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Freewrite Studio",
  robots: {
    index: false,
    follow: false,
  },
};

function getAdminAuthErrorMessage(error?: string): string | null {
  if (!error) return null;
  const normalized = error.toLowerCase();
  if (normalized === "access_denied" || normalized === "accessdenied") {
    return "That GitHub account is not authorized for this studio.";
  }
  if (normalized === "configuration" || normalized === "provider_not_found") {
    return "GitHub authentication is not configured yet.";
  }
  return "Unable to sign in with GitHub. Please try again.";
}

export default async function StudioPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
} = {}) {
  const [authenticated, resolvedParams] = await Promise.all([
    isAdminAuthenticated(),
    searchParams ?? Promise.resolve({} as { error?: string }),
  ]);
  const posts = authenticated ? await getAllAdminPosts() : [];
  const authError = !authenticated
    ? getAdminAuthErrorMessage(resolvedParams.error)
    : null;

  return (
    <FreewriteAdmin
      initialAuthenticated={authenticated}
      initialPosts={posts}
      initialAuthError={authError}
    />
  );
}
