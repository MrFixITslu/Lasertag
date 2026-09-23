import { readFile } from "node:fs/promises";
import { join } from "node:path";
type Content = Record<string, any>;
const env = process.env;
export const socialConnections = () => ({
  facebook: Boolean(env.FACEBOOK_PAGE_ID && env.FACEBOOK_PAGE_TOKEN),
  instagram: Boolean(env.INSTAGRAM_ACCOUNT_ID && env.INSTAGRAM_TOKEN),
  tiktok: Boolean(env.TIKTOK_ACCESS_TOKEN),
  youtube: Boolean(
    env.YOUTUBE_CLIENT_ID &&
    env.YOUTUBE_CLIENT_SECRET &&
    env.YOUTUBE_REFRESH_TOKEN,
  ),
});
async function json(url: string, options: RequestInit = {}) {
  const r = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30000),
  });
  const b = (await r.json()) as any;
  if (!r.ok || (b.error?.code && b.error.code !== "ok"))
    throw new Error("Provider rejected request.");
  return b;
}
const post = (body: unknown, token?: string): RequestInit => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
});
export async function tiktokCreator() {
  const b = await json(
    "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
    post({}, env.TIKTOK_ACCESS_TOKEN),
  );
  return b.data;
}
export async function publishSocial(
  platform: string,
  c: Content,
  origin: string,
  mediaDir: string,
  options: Content,
) {
  const url = c.media_id
    ? `${new URL(origin).origin}/uploads/${c.media_id}`
    : undefined;
  const video = c.mime?.startsWith("video/");
  const graph = `https://graph.facebook.com/${env.META_GRAPH_VERSION || "v25.0"}`;
  if (platform === "facebook") {
    const suffix = url ? (video ? "videos" : "photos") : "feed";
    const body = url
      ? video
        ? { file_url: url, description: c.body, title: c.title }
        : { url, caption: `${c.title}\n\n${c.body}` }
      : { message: `${c.title}\n\n${c.body}` };
    const b = await json(
      `${graph}/${env.FACEBOOK_PAGE_ID}/${suffix}`,
      post(body, env.FACEBOOK_PAGE_TOKEN),
    );
    if (!b.id) throw new Error("No post ID.");
    return {
      id: b.id,
      status: video ? "submitted" : "published",
      detail: video ? "Video submitted; check Facebook processing." : "",
    };
  }
  if (platform === "instagram") {
    if (
      !url ||
      (!video && c.mime !== "image/jpeg") ||
      (video && c.mime !== "video/mp4")
    )
      throw new Error("Instagram requires JPEG or MP4.");
    const b = await json(
      `${graph}/${env.INSTAGRAM_ACCOUNT_ID}/media`,
      post(
        {
          caption: `${c.title}\n\n${c.body}`,
          ...(video
            ? { media_type: "REELS", video_url: url }
            : { image_url: url }),
        },
        env.INSTAGRAM_TOKEN,
      ),
    );
    let ready = false;
    for (let i = 0; i < 12; i++) {
      const status = await json(`${graph}/${b.id}?fields=status_code`, {
        headers: { Authorization: `Bearer ${env.INSTAGRAM_TOKEN}` },
      });
      if (status.status_code === "FINISHED") {
        ready = true;
        break;
      }
      if (["ERROR", "EXPIRED"].includes(status.status_code))
        throw new Error("Media processing failed.");
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!ready) throw new Error("Processing not yet confirmed.");
    const published = await json(
      `${graph}/${env.INSTAGRAM_ACCOUNT_ID}/media_publish`,
      post({ creation_id: b.id }, env.INSTAGRAM_TOKEN),
    );
    if (!published.id) throw new Error("No post ID.");
    return { id: published.id, status: "published" };
  }
  if (platform === "tiktok") {
    if (!url || c.mime !== "video/mp4") throw new Error("TikTok requires MP4.");
    const creator = await tiktokCreator();
    if (!creator.privacy_level_options?.includes(options.privacy))
      throw new Error("Select an available privacy option.");
    // Interactions are disabled by default; business promotion disclosure is explicit.
    const b = await json(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      post(
        {
          post_info: {
            title: `${c.title}\n${c.body}`.slice(0, 2200),
            privacy_level: options.privacy,
            disable_duet: true,
            disable_comment: true,
            disable_stitch: true,
            brand_content_toggle: false,
            brand_organic_toggle: true,
          },
          source_info: { source: "PULL_FROM_URL", video_url: url },
        },
        env.TIKTOK_ACCESS_TOKEN,
      ),
    );
    if (!b.data?.publish_id) throw new Error("No publish ID.");
    return {
      id: b.data.publish_id,
      status: "submitted",
      detail:
        "TikTok is processing the upload; check your account. Own-business promotional content disclosure enabled.",
    };
  }
  if (platform === "youtube") {
    if (!url || c.mime !== "video/mp4")
      throw new Error("YouTube publishing requires MP4.");
    if (
      !["private", "unlisted", "public"].includes(options.privacy) ||
      typeof options.madeForKids !== "boolean"
    )
      throw new Error("Choose visibility and audience.");
    const token = await json("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: env.YOUTUBE_CLIENT_ID!,
        client_secret: env.YOUTUBE_CLIENT_SECRET!,
        refresh_token: env.YOUTUBE_REFRESH_TOKEN!,
        grant_type: "refresh_token",
      }),
    });
    const init = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        ...post(
          {
            snippet: {
              title: c.title.slice(0, 100),
              description: c.body,
              categoryId: "17",
            },
            status: {
              privacyStatus: options.privacy,
              selfDeclaredMadeForKids: options.madeForKids,
            },
          },
          token.access_token,
        ),
        signal: AbortSignal.timeout(30000),
      },
    );
    const location = init.headers.get("location");
    if (
      !init.ok ||
      !location ||
      new URL(location).hostname !== "www.googleapis.com"
    )
      throw new Error("Upload not initiated.");
    const data = await readFile(join(mediaDir, c.media_id));
    const b = await json(location, {
      method: "PUT",
      headers: { "Content-Type": c.mime },
      body: data,
    });
    if (!b.id) throw new Error("No video ID.");
    return {
      id: b.id,
      status: "submitted",
      detail:
        "YouTube accepted upload; processing and visibility remain subject to account approval.",
    };
  }
  throw new Error("Unsupported platform.");
}
