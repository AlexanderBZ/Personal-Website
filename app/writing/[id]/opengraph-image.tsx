import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { formatLongDate, getPostById } from "@/lib/posts";
import { SITE_CONFIG } from "@/lib/site";

export const alt = SITE_CONFIG.name;
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

// Satori (next/og) supports TTF/OTF/WOFF but not WOFF2, so fonts are bundled locally as TTF.
function loadFont(fileName: string): Promise<Buffer | null> {
  return readFile(join(process.cwd(), "assets", "fonts", fileName)).catch(
    () => null,
  );
}

const interRegularPromise = loadFont("Inter-Regular.ttf");
const interSemiBoldPromise = loadFont("Inter-SemiBold.ttf");

export default async function PostOpenGraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, interRegular, interSemiBold] = await Promise.all([
    params,
    interRegularPromise,
    interSemiBoldPromise,
  ]);
  const post = await getPostById(id);

  const title = post?.title ?? SITE_CONFIG.name;
  const summary = post?.summary ?? SITE_CONFIG.description;
  const formattedDate = post?.date ? formatLongDate(post.date) : "";
  const fonts = [
    ...(interRegular
      ? [{ name: "Inter", data: interRegular, style: "normal" as const, weight: 400 as const }]
      : []),
    ...(interSemiBold
      ? [{ name: "Inter", data: interSemiBold, style: "normal" as const, weight: 600 as const }]
      : []),
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#fdfdfc",
          color: "#111111",
          padding: "80px 96px",
          fontFamily: fonts.length > 0 ? "Inter, sans-serif" : "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 26,
            color: "rgba(0, 0, 0, 0.45)",
          }}
        >
          <span>{SITE_CONFIG.name}</span>
          {formattedDate ? <span>{formattedDate}</span> : null}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "24px",
            maxWidth: "960px",
          }}
        >
          <div
            style={{
              fontSize: 64,
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: "-0.025em",
              color: "#111111",
            }}
          >
            {title}
          </div>
          {summary ? (
            <div
              style={{
                fontSize: 30,
                lineHeight: 1.4,
                color: "rgba(0, 0, 0, 0.55)",
              }}
            >
              {summary}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 22,
            color: "rgba(0, 0, 0, 0.4)",
            borderTop: "1px solid #f2f2f2",
            paddingTop: "28px",
          }}
        >
          <span>alexanderzwerner.com</span>
        </div>
      </div>
    ),
    {
      ...size,
      ...(fonts.length > 0 ? { fonts } : {}),
    },
  );
}

