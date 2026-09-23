import { afterEach, describe, expect, it, vi } from "vitest";
import { publishSocial } from "./social";
const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("social provider adapters (mocked; never publish live)", () => {
  it("posts Facebook text and requires a provider reference", async () => {
    vi.stubEnv("FACEBOOK_PAGE_ID", "test-page");
    vi.stubEnv("FACEBOOK_PAGE_TOKEN", "test-token");
    const send = vi.fn().mockResolvedValue(response({ id: "post-123" }));
    vi.stubGlobal("fetch", send);
    const result = await publishSocial(
      "facebook",
      { title: "Game on", body: "Rally your squad" },
      "https://example.com",
      "/tmp",
      {},
    );
    expect(result.status).toBe("published");
    expect(result.id).toBe("post-123");
    expect(send.mock.calls[0][0]).toContain("/test-page/feed");
    const payload = JSON.parse(send.mock.calls[0][1].body);
    expect(payload.message).toBe("Game on\n\nRally your squad");
  });
  it("waits for an Instagram container to be finished before publishing", async () => {
    vi.stubEnv("INSTAGRAM_ACCOUNT_ID", "ig-test");
    vi.stubEnv("INSTAGRAM_TOKEN", "test-token");
    const send = vi
      .fn()
      .mockResolvedValueOnce(response({ id: "container" }))
      .mockResolvedValueOnce(response({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(response({ id: "ig-post" }));
    vi.stubGlobal("fetch", send);
    const result = await publishSocial(
      "instagram",
      {
        title: "Game on",
        body: "Rally your squad",
        media_id: "asset",
        mime: "image/jpeg",
      },
      "https://example.com",
      "/tmp",
      {},
    );
    expect(result.id).toBe("ig-post");
    expect(send.mock.calls[2][0]).toContain("/ig-test/media_publish");
    expect(JSON.parse(send.mock.calls[0][1].body).image_url).toBe(
      "https://example.com/uploads/asset",
    );
  });
  it("uses TikTok creator-selected privacy and labels uploads as submitted", async () => {
    vi.stubEnv("TIKTOK_ACCESS_TOKEN", "test-token");
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: { privacy_level_options: ["SELF_ONLY"] },
          error: { code: "ok" },
        }),
      )
      .mockResolvedValueOnce(
        response({ data: { publish_id: "tt-upload" }, error: { code: "ok" } }),
      );
    vi.stubGlobal("fetch", send);
    const result = await publishSocial(
      "tiktok",
      {
        title: "Game on",
        body: "Squad mission",
        media_id: "asset",
        mime: "video/mp4",
      },
      "https://example.com",
      "/tmp",
      { privacy: "SELF_ONLY" },
    );
    expect(result.status).toBe("submitted");
    const info = JSON.parse(send.mock.calls[1][1].body).post_info;
    expect(info.privacy_level).toBe("SELF_ONLY");
    expect(info.brand_organic_toggle).toBe(true);
    expect(info.disable_comment).toBe(true);
  });
  it("rejects unsupported media before contacting YouTube", async () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    await expect(
      publishSocial(
        "youtube",
        { media_id: "asset", mime: "image/jpeg" },
        "https://example.com",
        "/tmp",
        { privacy: "private", madeForKids: false },
      ),
    ).rejects.toThrow("MP4");
    expect(send).not.toHaveBeenCalled();
  });
});
