"use client";

import { useEffect } from "react";
import PageLayout from "@/components/PageLayout";
import { captureClientException } from "@/lib/posthog-client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureClientException(error);
  }, [error]);

  return (
    <PageLayout title="Something went wrong">
      <p>An unexpected error occurred.</p>
      <p>
        <button type="button" onClick={() => reset()} className="basic-link">
          Try again
        </button>
      </p>
    </PageLayout>
  );
}

