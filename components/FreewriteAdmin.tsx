"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  blocksToText,
  getTodayIso,
  type PostStatus,
  slugify,
  type WritingPost,
} from "@/lib/format";
import {
  captureClientEvent,
  captureClientException,
  getPostHogCorrelationHeaders as getPostHogHeaders,
  identifyClientUser,
  resetClientPostHog,
} from "@/lib/posthog-client";

interface FreewriteAdminProps {
  initialAuthenticated: boolean;
  initialPosts: WritingPost[];
  initialAuthError?: string | null;
}

type FontChoice = "sans" | "serif" | "mono";
const FONT_FAMILIES: Record<FontChoice, string> = {
  sans: "var(--font-primary)",
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
};

const FONT_LABELS: Record<FontChoice, string> = {
  sans: "Inter",
  serif: "Serif",
  mono: "Mono",
};

const FONT_ORDER: FontChoice[] = ["sans", "serif", "mono"];
const FONT_SIZES = [16, 18, 20, 22, 24] as const;

const PLACEHOLDERS = [
  "Begin writing...",
  "Pick a thought and let it flow...",
  "Write without stopping...",
  "What's on your mind today?",
];

export default function FreewriteAdmin({
  initialAuthenticated,
  initialPosts,
  initialAuthError = null,
}: FreewriteAdminProps) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [authError, setAuthError] = useState<string | null>(initialAuthError);
  const [authLoading, setAuthLoading] = useState(false);

  const [posts, setPosts] = useState<WritingPost[]>(initialPosts);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(
    initialPosts[0]?.id ?? null,
  );

  // Active editor fields
  const [title, setTitle] = useState(initialPosts[0]?.title ?? "");
  const [slug, setSlug] = useState(initialPosts[0]?.id ?? "");
  const [date, setDate] = useState(initialPosts[0]?.date ?? getTodayIso());
  const [summary, setSummary] = useState(initialPosts[0]?.summary ?? "");
  const [bodyText, setBodyText] = useState(
    initialPosts[0] ? blocksToText(initialPosts[0].content) : "",
  );
  const [postStatus, setPostStatus] = useState<PostStatus>(
    initialPosts[0] ? (initialPosts[0].status ?? "published") : "draft",
  );

  // Freewrite UI state
  const [font, setFont] = useState<FontChoice>("sans");
  const [fontSizeIndex, setFontSizeIndex] = useState(1); // 18px default like Freewrite
  const [isTyping, setIsTyping] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showMetaDrawer, setShowMetaDrawer] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [autoSavePaused, setAutoSavePaused] = useState(false);

  const typingTimeoutRef = useRef<number | null>(null);
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveStatusRef = useRef<PostStatus | null>(null);
  const revisionRef = useRef(0);
  const entrySessionRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const clearPendingTimers = useCallback(() => {
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (autoSaveTimeoutRef.current !== null) {
      window.clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearPendingTimers();
    };
  }, [clearPendingTimers]);

  useEffect(() => {
    if (initialAuthenticated) {
      identifyClientUser("admin", { role: "admin" });
    }
  }, [initialAuthenticated]);

  const markDirty = useCallback(() => {
    revisionRef.current += 1;
    setIsDirty(true);
    setAutoSavePaused(false);
    setSaveStatus("Unsaved");
  }, []);

  const selectPost = useCallback(
    (post: WritingPost) => {
      clearPendingTimers();
      entrySessionRef.current += 1;
      revisionRef.current += 1;
      setSelectedPostId(post.id);
      setTitle(post.title);
      setSlug(post.id);
      setDate(post.date);
      setSummary(post.summary);
      setBodyText(blocksToText(post.content));
      setPostStatus(post.status ?? "published");
      setIsDirty(false);
      setAutoSavePaused(false);
      pendingSaveStatusRef.current = null;
      setSaveStatus(null);
    },
    [clearPendingTimers],
  );

  const startNewEntry = useCallback(() => {
    clearPendingTimers();
    entrySessionRef.current += 1;
    revisionRef.current += 1;
    setSelectedPostId(null);
    setTitle("");
    setSlug("");
    setDate(getTodayIso());
    setSummary("");
    setBodyText("");
    setPostStatus("draft");
    setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDERS.length);
    setIsDirty(false);
    setAutoSavePaused(false);
    pendingSaveStatusRef.current = null;
    setSaveStatus(null);
    captureClientEvent("new_post_started");
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [clearPendingTimers]);

  // Restore chrome on mouse move
  useEffect(() => {
    const handleMouseMove = () => {
      setIsTyping(false);
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const markTyping = useCallback(() => {
    setIsTyping(true);
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      setIsTyping(false);
    }, 2500);
  }, []);

  const wordCount = useMemo(() => {
    const trimmed = bodyText.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }, [bodyText]);

  const handleSave = useCallback(
    async (isAutoSave = false, targetStatus?: PostStatus) => {
      const effectiveStatus = targetStatus ?? postStatus;
      if (isSavingRef.current) {
        if (!isAutoSave) {
          pendingSaveStatusRef.current = effectiveStatus;
        }
        return;
      }
      isSavingRef.current = true;
      setIsSaving(true);
      pendingSaveStatusRef.current = null;
      const wasPublished = postStatus === "published";
      setSaveStatus(
        effectiveStatus === "draft"
          ? "Saving draft..."
          : wasPublished
            ? "Updating..."
            : "Publishing...",
      );

      const savedRevision = revisionRef.current;
      const savedEntrySession = entrySessionRef.current;
      const effectiveTitle = title.trim() || "Untitled";
      const effectiveSlug = slugify(slug.trim() || effectiveTitle);
      const isNewPost = !selectedPostId;

      try {
        const response = await fetch("/api/studio/posts", {
          method: "POST",
          headers: getPostHogHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            originalId: selectedPostId ?? undefined,
            id: effectiveSlug,
            title: effectiveTitle,
            date: date || getTodayIso(),
            summary: summary.trim(),
            bodyText,
            status: effectiveStatus,
          }),
        });

        if (response.status === 401) {
          setAuthenticated(false);
          setAutoSavePaused(true);
          setAuthError("Session expired. Sign in again to save your draft.");
          setSaveStatus("Session expired");
          return;
        }

        if (!response.ok) {
          const err = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          setAutoSavePaused(true);
          setSaveStatus(err.error || "Error saving");
          return;
        }

        const data = (await response.json()) as {
          post: WritingPost;
          posts: WritingPost[];
        };
        const savedStatus: PostStatus = data.post.status ?? "published";
        setPosts(data.posts);

        if (!isAutoSave || savedStatus === "published") {
          captureClientEvent("post_saved", {
            post_id: data.post.id,
            status: savedStatus,
            is_new_post: isNewPost,
            word_count: wordCount,
          });
        }

        if (entrySessionRef.current !== savedEntrySession) {
          return;
        }

        setSelectedPostId(data.post.id);
        setPostStatus(savedStatus);
        setAutoSavePaused(false);

        // Only overwrite active editor fields if the user hasn't typed newer changes mid-request
        if (revisionRef.current === savedRevision) {
          setTitle(data.post.title);
          setSlug(data.post.id);
          setDate(data.post.date);
          setSummary(data.post.summary);
          setIsDirty(false);
          setSaveStatus(
            savedStatus === "draft"
              ? "Draft saved"
              : wasPublished
                ? "Updated"
                : "Published",
          );
        } else {
          setSaveStatus("Unsaved");
        }
      } catch (error) {
        captureClientException(error);
        setAutoSavePaused(true);
        setSaveStatus("Error saving");
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
      }
    },
    [bodyText, date, postStatus, selectedPostId, slug, summary, title, wordCount],
  );

  useEffect(() => {
    if (!authenticated || isSaving || !pendingSaveStatusRef.current) return;
    const nextStatus = pendingSaveStatusRef.current;
    pendingSaveStatusRef.current = null;
    void handleSave(false, nextStatus);
  }, [authenticated, handleSave, isSaving]);

  // Debounced auto-save for drafts only (live posts stay local until Update)
  useEffect(() => {
    if (
      !authenticated ||
      !isDirty ||
      isSaving ||
      autoSavePaused ||
      postStatus !== "draft"
    ) {
      return;
    }
    if (
      !selectedPostId &&
      !title.trim() &&
      !bodyText.trim() &&
      !summary.trim()
    ) {
      return;
    }

    if (autoSaveTimeoutRef.current !== null) {
      window.clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = window.setTimeout(() => {
      void handleSave(true);
    }, 1500);

    return () => {
      if (autoSaveTimeoutRef.current !== null) {
        window.clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [
    authenticated,
    autoSavePaused,
    bodyText,
    date,
    handleSave,
    isDirty,
    isSaving,
    postStatus,
    selectedPostId,
    slug,
    summary,
    title,
  ]);

  // Warn before closing the tab with unsaved edits (drafts can be mid-debounce too)
  useEffect(() => {
    if (!authenticated || !isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [authenticated, isDirty]);

  /** Asks before switching away from an entry with unsaved edits. */
  const confirmDiscardChanges = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm("You have unsaved changes. Discard them?");
  }, [isDirty]);

  // Cmd/Ctrl + S shortcut
  useEffect(() => {
    if (!authenticated) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authenticated, handleSave]);

  const handleDelete = async (idToDelete: string) => {
    const confirmed = window.confirm(
      `Delete "${idToDelete}"? This will remove it from your website.`,
    );
    if (!confirmed) return;

    try {
      const response = await fetch(
        `/api/studio/posts?id=${encodeURIComponent(idToDelete)}`,
        {
          method: "DELETE",
          headers: getPostHogHeaders(),
        },
      );

      if (response.status === 401) {
        setAuthenticated(false);
        setAuthError("Session expired. Please sign in again.");
        return;
      }

      if (!response.ok) {
        setSaveStatus("Error deleting");
        return;
      }

      captureClientEvent("post_deleted", {
        post_id: idToDelete,
      });

      const data = (await response.json()) as { posts: WritingPost[] };
      setPosts(data.posts);
      if (selectedPostId === idToDelete) {
        if (data.posts[0]) {
          selectPost(data.posts[0]);
        } else {
          startNewEntry();
        }
      }
    } catch (error) {
      captureClientException(error);
      setSaveStatus("Error deleting");
    }
  };

  const handleGitHubLogin = async () => {
    setAuthLoading(true);
    setAuthError(null);

    try {
      captureClientEvent("admin_login_started", { provider: "github" });
      const result = await authClient.signIn.social({
        provider: "github",
        callbackURL: "/studio",
        errorCallbackURL: "/studio",
      });
      if (result?.error) {
        setAuthError(result.error.message || "Unable to sign in with GitHub");
        setAuthLoading(false);
      }
    } catch (error) {
      captureClientException(error);
      setAuthError("Unable to sign in with GitHub");
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirmDiscardChanges()) return;
    clearPendingTimers();
    entrySessionRef.current += 1;
    pendingSaveStatusRef.current = null;
    captureClientEvent("admin_signed_out");
    resetClientPostHog();
    try {
      await authClient.signOut();
    } finally {
      setAuthenticated(false);
    }
  };

  const cycleFont = () => {
    setFont((prev) => FONT_ORDER[(FONT_ORDER.indexOf(prev) + 1) % FONT_ORDER.length]);
  };

  const cycleFontSize = () => {
    setFontSizeIndex((prev) => (prev + 1) % FONT_SIZES.length);
  };

  if (!authenticated) {
    return (
      <div className="freewrite-login">
        <div className="freewrite-login-form">
          <div className="freewrite-login-header">
            <h1>freewrite</h1>
            <p>Sign in with an authorized GitHub account to open the writing studio.</p>
          </div>

          {authError ? (
            <p className="freewrite-error" role="alert">
              {authError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void handleGitHubLogin()}
            disabled={authLoading}
            className="freewrite-primary-btn"
          >
            {authLoading ? "Redirecting..." : "Continue with GitHub"}
          </button>
        </div>
      </div>
    );
  }

  const currentFontSize = FONT_SIZES[fontSizeIndex];

  return (
    <div className="freewrite-studio" data-typing={isTyping}>
      {/* Top bar — fades out while typing */}
      <header className="freewrite-topbar">
        <div className="freewrite-topbar-left">
          <button
            type="button"
            onClick={() => setShowMetaDrawer((prev) => !prev)}
            className="freewrite-nav-btn"
          >
            {showMetaDrawer ? "Hide details" : "Post details"}
          </button>
          {postStatus === "draft" ? (
            <>
              <span className="freewrite-dot">•</span>
              <span className="freewrite-badge">Draft</span>
            </>
          ) : selectedPostId ? (
            <>
              <span className="freewrite-dot">•</span>
              <Link
                href={`/writing/${selectedPostId}`}
                target="_blank"
                className="freewrite-nav-btn"
              >
                View live ↗
              </Link>
            </>
          ) : null}
        </div>

        <div className="freewrite-topbar-right">
          {saveStatus ? (
            <span className="freewrite-status" aria-live="polite">
              {saveStatus}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSave(false, "published")}
            disabled={isSaving}
            className="freewrite-save-btn"
          >
            {postStatus === "draft" ? "Publish" : "Update"}
          </button>
        </div>
      </header>

      {/* Collapsible metadata drawer for slug, date, summary */}
      {showMetaDrawer ? (
        <section className="freewrite-meta-drawer" aria-label="Post metadata">
          <div className="freewrite-meta-grid">
            <label className="freewrite-meta-field">
              <span>URL Slug</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  markDirty();
                }}
                placeholder={slugify(title || "post-slug")}
              />
            </label>
            <label className="freewrite-meta-field">
              <span>Date (YYYY-MM-DD)</span>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  markDirty();
                }}
              />
            </label>
          </div>
          <label className="freewrite-meta-field">
            <span>Summary (for SEO & OpenGraph)</span>
            <input
              type="text"
              value={summary}
              onChange={(e) => {
                setSummary(e.target.value);
                markDirty();
              }}
              placeholder="Defaults to first paragraph if left blank..."
            />
          </label>
          <p className="freewrite-meta-hint">
            Tip: Separate paragraphs with a blank line. Start a line with{" "}
            <code>## Section Name</code> to create a section divider + Table of
            Contents heading. Drafts auto-save as you write; edits to live posts
            stay local until you click Update (or press <code>⌘S</code>).
          </p>
        </section>
      ) : null}

      {/* Main distraction-free writing canvas + optional right history drawer */}
      <div className="freewrite-main">
        <div
          className="freewrite-canvas"
          style={{ fontFamily: FONT_FAMILIES[font] }}
        >
          <input
            type="text"
            value={title}
            onChange={(e) => {
              const nextTitle = e.target.value;
              setTitle(nextTitle);
              // Keep the slug in sync with the title for new posts and drafts,
              // unless the slug was customized (live post URLs never change implicitly).
              if (
                !selectedPostId ||
                (postStatus === "draft" && slug === slugify(title))
              ) {
                setSlug(slugify(nextTitle));
              }
              markDirty();
              markTyping();
            }}
            placeholder="Title..."
            aria-label="Post title"
            className="freewrite-title-input"
          />

          <textarea
            ref={textareaRef}
            value={bodyText}
            onChange={(e) => {
              setBodyText(e.target.value);
              markDirty();
              markTyping();
            }}
            placeholder={PLACEHOLDERS[placeholderIndex]}
            aria-label="Post content"
            className="freewrite-textarea"
            style={{
              fontSize: `${currentFontSize}px`,
              lineHeight: 1.65,
            }}
          />
        </div>

        {showSidebar ? (
          <aside className="freewrite-sidebar" aria-label="Post history">
            <div className="freewrite-sidebar-header">
              <h2>Posts ({posts.length})</h2>
              <button
                type="button"
                onClick={() => {
                  if (confirmDiscardChanges()) startNewEntry();
                }}
                className="freewrite-nav-btn"
              >
                + New
              </button>
            </div>
            <ul className="freewrite-history-list">
              {posts.map((post) => {
                const isSelected = post.id === selectedPostId;
                return (
                  <li key={post.id} data-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isSelected && confirmDiscardChanges()) {
                          selectPost(post);
                        }
                      }}
                      className="freewrite-history-item"
                    >
                      <span className="freewrite-history-title">
                        {post.title}
                      </span>
                      <span className="freewrite-history-date">
                        {post.date}
                        {post.status === "draft" ? " · Draft" : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(post.id)}
                      aria-label={`Delete ${post.title}`}
                      className="freewrite-delete-btn"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        ) : null}
      </div>

      {/* Bottom Freewrite utility bar — fades out while typing */}
      <footer className="freewrite-bottombar">
        <div className="freewrite-bottom-left">
          <button
            type="button"
            onClick={cycleFontSize}
            className="freewrite-nav-btn"
            title="Cycle font size"
          >
            {currentFontSize}px
          </button>
          <span className="freewrite-dot">•</span>
          <button
            type="button"
            onClick={cycleFont}
            className="freewrite-nav-btn"
            title="Switch font family"
          >
            {FONT_LABELS[font]}
          </button>
          <span className="freewrite-dot">•</span>
          <span className="freewrite-wordcount">
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </span>
        </div>

        <div className="freewrite-bottom-right">
          <button
            type="button"
            onClick={() => {
                  if (confirmDiscardChanges()) startNewEntry();
                }}
            className="freewrite-nav-btn"
          >
            New Entry
          </button>
          <span className="freewrite-dot">•</span>
          <button
            type="button"
            onClick={() => setShowSidebar((prev) => !prev)}
            className="freewrite-nav-btn"
          >
            History ({posts.length})
          </button>
          <span className="freewrite-dot">•</span>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="freewrite-nav-btn"
          >
            Sign out
          </button>
        </div>
      </footer>
    </div>
  );
}
