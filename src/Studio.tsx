import { useEffect, useRef, useState } from "react";
import { api } from "./lib/api";
import type { AdminSession } from "./BusinessConsole";
type Row = Record<string, any>;
const presets = {
  birthday: {
    headline: "BIRTHDAY\nSTRIKE.",
    subtitle: "One birthday. Two teams. Legendary memories.",
    cta: "RALLY YOUR SQUAD",
    accent: "#c4ff38",
  },
  corporate: {
    headline: "TEAMWORK.\nUNDER FIRE.",
    subtitle: "Take your next team day out of the office.",
    cta: "PLAN YOUR TEAM MISSION",
    accent: "#3de8db",
  },
  community: {
    headline: "YOUR COMMUNITY.\nGAME ON.",
    subtitle: "Mobile laser tag. Real-world teamwork. Saint Lucia.",
    cta: "ENTER THE ZONE",
    accent: "#ffad45",
  },
};
const sizes: Record<string, [number, number]> = {
  portrait: [1080, 1920],
  square: [1080, 1080],
  landscape: [1920, 1080],
};
export default function Studio({ session }: { session: AdminSession }) {
  const [media, setMedia] = useState<Row[]>([]),
    [content, setContent] = useState<Row[]>([]),
    [posts, setPosts] = useState<Row[]>([]),
    [connections, setConnections] = useState<Row>({});
  const [design, setDesign] = useState({
    ...presets.birthday,
    format: "portrait",
    backgroundId: "",
    footer: "COMBATZONE SLU • MOBILE LASER TAG",
  });
  const [title, setTitle] = useState("Birthday Strike"),
    [body, setBody] = useState(
      "Outthink. Outflank. Outplay. Turn your next birthday into a team mission with CombatZone SLU.\n\nRequest your booking: " +
        location.origin +
        "/#booking\n\n#CombatZoneSLU #SaintLucia #LaserTag",
    );
  const [kind, setKind] = useState("campaign"),
    [eventDate, setEventDate] = useState(""),
    [venue, setVenue] = useState(""),
    [live, setLive] = useState(false),
    [asset, setAsset] = useState(""),
    [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [platform, setPlatform] = useState("facebook"),
    [privacy, setPrivacy] = useState(""),
    [kids, setKids] = useState(""),
    [creator, setCreator] = useState<Row | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    source = useRef<HTMLImageElement | HTMLVideoElement | null>(null),
    start = useRef(0),
    recorder = useRef<MediaRecorder | null>(null),
    timer = useRef<number>();
  const headers = { "X-CSRF-Token": session.csrf };
  const load = async () => {
    const [m, c, p, n] = await Promise.all([
      api<Row[]>("/api/admin/media"),
      api<Row[]>("/api/admin/content"),
      api<Row[]>("/api/admin/social-posts"),
      api<Row>("/api/admin/connections"),
    ]);
    setMedia(m);
    setContent(c);
    setPosts(p);
    setConnections(n);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    return () => {
      clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
    };
  }, []);
  useEffect(() => {
    source.current = null;
    const m = media.find((m) => m.id === design.backgroundId);
    if (!m) return;
    const element = m.mime.startsWith("video/")
      ? document.createElement("video")
      : new Image();
    element.src = `/api/admin/media/${m.id}`;
    if (element instanceof HTMLVideoElement) {
      element.muted = true;
      element.loop = true;
      element.playsInline = true;
      void element.play().catch(() => {});
    }
    source.current = element;
    return () => {
      if (element instanceof HTMLVideoElement) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      source.current = null;
    };
  }, [design.backgroundId, media]);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const c = canvas.current;
      if (!c) return;
      const ctx = c.getContext("2d")!;
      const [w, h] = sizes[design.format];
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const t = recording ? (performance.now() - start.current) / 1000 : 3;
      paint(ctx, w, h, design, source.current, t);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [design, recording]);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/admin/media", {
      method: "POST",
      headers,
      body: form,
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error || "Upload failed. Maximum 80 MB.");
    await load();
    return b.id as string;
  }
  async function exportImage() {
    await task(async () => {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.current!.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Unable to export image.")),
          "image/jpeg",
          0.95,
        ),
      );
      const file = new File([blob], "combatzone-creative.jpg", {
        type: "image/jpeg",
      });
      download(file);
      setAsset(await upload(file));
      setNotice(
        "JPEG downloaded and saved to your media library. Save the campaign to attach it.",
      );
    });
  }
  function record() {
    if (!window.MediaRecorder || !canvas.current?.captureStream) {
      setError(
        "This browser does not support video creation. Use a current desktop Chrome or Firefox.",
      );
      return;
    }
    setError("");
    setRecording(true);
    start.current = performance.now();
    if (source.current instanceof HTMLVideoElement) {
      source.current.currentTime = 0;
      void source.current.play().catch(() => {});
    }
    const stream = canvas.current.captureStream(30);
    const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find(
      (t) => MediaRecorder.isTypeSupported(t),
    );
    if (!mime) {
      setRecording(false);
      setError("No supported recording format.");
      return;
    }
    const chunks: BlobPart[] = [];
    const r = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 6000000,
    });
    recorder.current = r;
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      const file = new File(
        chunks,
        `combatzone-promo.${mime.includes("mp4") ? "mp4" : "webm"}`,
        { type: mime.split(";")[0] },
      );
      void task(async () => {
        download(file);
        setAsset(await upload(file));
        setNotice(
          "12-second silent promo saved. WebM is converted to MP4 on the server for social publishing.",
        );
      });
    };
    r.onerror = () => setError("Recording failed. Please retry.");
    r.start();
    timer.current = window.setTimeout(() => r.stop(), 12000);
  }
  async function save() {
    await task(async () => {
      const saved = await api<Row>("/api/admin/content", {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: editing?.id,
          version: editing?.version,
          kind,
          title,
          body,
          eventDate,
          location: venue,
          mediaId: asset,
          live,
          design,
        }),
      });
      const rows = await api<Row[]>("/api/admin/content");
      setContent(rows);
      setEditing(rows.find((c) => c.id === saved.id) || null);
      setNotice(
        live ? "Event is now visible on the landing page." : "Draft saved.",
      );
    });
  }
  function open(c: Row) {
    setEditing(c);
    setKind(c.kind);
    setTitle(c.title);
    setBody(c.body);
    setEventDate(c.event_date);
    setVenue(c.location);
    setAsset(c.media_id || "");
    setLive(Boolean(c.live));
    try {
      const d = JSON.parse(c.design);
      setDesign({
        ...presets.birthday,
        format: "portrait",
        backgroundId: "",
        footer: "COMBATZONE SLU • MOBILE LASER TAG",
        ...d,
      });
    } catch {}
    setNotice("Draft loaded.");
  }
  async function publish() {
    if (!editing) {
      setError("Save your campaign before publishing.");
      return;
    }
    if (
      !window.confirm(
        `Publish the saved version of “${editing.title}” to ${platform}? Its attached media will become publicly accessible.`,
      )
    )
      return;
    await task(async () => {
      const result = await api<Row>(
        `/api/admin/content/${editing.id}/publish`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            platform,
            confirm: true,
            privacy,
            madeForKids: kids === "yes",
          }),
        },
      );
      setNotice(`${result.status}: ${result.detail || result.id}`);
      await load();
    });
  }
  return (
    <section className="business-panel studio-panel hud-panel">
      <div className="business-heading">
        <div>
          <p className="eyebrow">CREATE. RALLY. DEPLOY.</p>
          <h2>CAMPAIGN LAB.</h2>
          <p>Your creative studio, event board and publishing desk.</p>
        </div>
        <button
          disabled={busy || recording}
          onClick={() => {
            setEditing(null);
            setLive(false);
            setNotice("New draft. Your current copy is ready to reuse.");
          }}
        >
          NEW DRAFT
        </button>
      </div>
      {error && (
        <p role="alert" className="admin-message admin-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="admin-message">
          {notice}
        </p>
      )}
      <fieldset disabled={busy || recording} className="studio-fieldset">
        <div className="studio-layout">
          <div className="studio-controls">
            <h3>01 / BUILD YOUR LOOK</h3>
            <div className="studio-presets">
              {Object.entries(presets).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => setDesign((d) => ({ ...d, ...p }))}
                >
                  {key}
                </button>
              ))}
            </div>
            <label>
              Format
              <select
                value={design.format}
                onChange={(e) =>
                  setDesign((d) => ({ ...d, format: e.target.value }))
                }
              >
                <option value="portrait">Story / Reel · 1080 × 1920</option>
                <option value="square">Square post · 1080 × 1080</option>
                <option value="landscape">
                  YouTube / banner · 1920 × 1080
                </option>
              </select>
            </label>
            <label>
              Headline
              <textarea
                rows={2}
                maxLength={80}
                value={design.headline}
                onChange={(e) =>
                  setDesign((d) => ({ ...d, headline: e.target.value }))
                }
              />
            </label>
            <label>
              Supporting line
              <input
                maxLength={100}
                value={design.subtitle}
                onChange={(e) =>
                  setDesign((d) => ({ ...d, subtitle: e.target.value }))
                }
              />
            </label>
            <label>
              Call to action
              <input
                maxLength={40}
                value={design.cta}
                onChange={(e) =>
                  setDesign((d) => ({ ...d, cta: e.target.value }))
                }
              />
            </label>
            <label>
              Footer
              <input
                maxLength={90}
                value={design.footer}
                onChange={(e) =>
                  setDesign((d) => ({ ...d, footer: e.target.value }))
                }
              />
            </label>
            <label>
              Accent colour
              <input
                type="color"
                value={design.accent}
                onChange={(e) =>
                  setDesign((d) => ({ ...d, accent: e.target.value }))
                }
              />
            </label>
            <label>
              Background footage / image
              <select
                value={design.backgroundId}
                onChange={(e) =>
                  setDesign((d) => ({ ...d, backgroundId: e.target.value }))
                }
              >
                <option value="">Combat grid background</option>
                {media.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-upload">
              Upload your image or footage
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    void task(async () => {
                      const id = await upload(f);
                      setDesign((d) => ({ ...d, backgroundId: id }));
                      setAsset(id);
                      setNotice("Media uploaded.");
                    });
                  e.target.value = "";
                }}
              />
            </label>
            <p className="admin-help">
              Use media you have permission to publish. Upload your licensed
              Falcon footage here; the landing page’s YouTube embed cannot be
              reused as an editable video asset.
            </p>
          </div>
          <div className="studio-preview">
            <canvas
              ref={canvas}
              aria-label="Live branded campaign artwork preview"
            />
            <div className="business-row">
              <button onClick={() => void exportImage()}>
                EXPORT & SAVE JPEG
              </button>
              <button onClick={record}>CREATE 12-SECOND VIDEO</button>
            </div>
            <p aria-live="polite">
              {recording
                ? "Recording animation… keep this tab open."
                : "Preview crops to fill. Keep subjects centred. Videos have animated type and no soundtrack. Uploads are normalised to JPEG/MP4; videos are capped at 60 seconds."}
            </p>
          </div>
        </div>
        <div className="studio-layout">
          <div className="business-form">
            <h3>02 / WRITE THE MISSION BRIEF</h3>
            <label>
              Content type
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  if (e.target.value !== "event") setLive(false);
                }}
              >
                <option value="campaign">Marketing campaign</option>
                <option value="event">Public event</option>
              </select>
            </label>
            <label>
              Title
              <input
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Caption / description
              <textarea
                rows={7}
                maxLength={5000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <button
              onClick={() => {
                setTitle(design.headline.replaceAll("\n", " "));
                setBody(
                  `${design.headline.replaceAll("\n", " ")}\n\n${design.subtitle}\n\n${design.cta}: ${location.origin}/#booking\n\n#CombatZoneSLU #SaintLucia #LaserTag`,
                );
              }}
            >
              BUILD CAPTION FROM DESIGN
            </button>
            <label>
              Attach finished artwork / video
              <select value={asset} onChange={(e) => setAsset(e.target.value)}>
                <option value="">No attachment</option>
                {media.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.mime}
                  </option>
                ))}
              </select>
            </label>
            {kind === "event" && (
              <>
                <label>
                  Event date (Saint Lucia)
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                </label>
                <label>
                  Location
                  <input
                    maxLength={150}
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
                  />
                </label>
                <label className="business-check">
                  <input
                    type="checkbox"
                    checked={live}
                    onChange={(e) => setLive(e.target.checked)}
                  />
                  Publish event on landing page
                </label>
              </>
            )}
            <button className="primary-action" onClick={() => void save()}>
              SAVE {live ? "& PUBLISH EVENT" : "DRAFT"}
            </button>
          </div>
          <div className="business-form">
            <h3>03 / DEPLOY YOUR CAMPAIGN</h3>
            <p>
              Publish the last saved version. Save your edits first. JPEG images
              work with Instagram; use MP4 for video channels.
            </p>
            <label>
              Channel
              <select
                value={platform}
                onChange={(e) => {
                  setPlatform(e.target.value);
                  setPrivacy("");
                  setKids("");
                  setCreator(null);
                }}
              >
                <option value="facebook">Facebook Page</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
              </select>
            </label>
            <p>
              {connections[platform]
                ? "Credentials configured — approval and token validity are checked by the provider."
                : "Not connected. Configure this channel in server settings to publish."}
            </p>
            {platform === "tiktok" && (
              <>
                <button
                  onClick={() =>
                    void task(async () => {
                      setCreator(await api<Row>("/api/admin/tiktok-creator"));
                    })
                  }
                >
                  LOAD TIKTOK ACCOUNT & OPTIONS
                </button>
                {creator && (
                  <p>
                    Posting as {creator.creator_nickname}. Own-business
                    promotion disclosure enabled. Comments, Duets and Stitches
                    disabled. Maximum {creator.max_video_post_duration_sec}{" "}
                    seconds.
                  </p>
                )}
                <label>
                  Visibility
                  <select
                    value={privacy}
                    onChange={(e) => setPrivacy(e.target.value)}
                  >
                    <option value="">Choose visibility</option>
                    {creator?.privacy_level_options?.map((p: string) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <p>
                  By publishing, you agree to TikTok’s Music Usage Confirmation.
                  Use only footage/audio you have rights to share.
                </p>
              </>
            )}
            {platform === "youtube" && (
              <>
                <label>
                  Visibility
                  <select
                    value={privacy}
                    onChange={(e) => setPrivacy(e.target.value)}
                  >
                    <option value="">Choose visibility</option>
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <label>
                  Is this video made for kids?
                  <select
                    value={kids}
                    onChange={(e) => setKids(e.target.value)}
                  >
                    <option value="">Choose audience</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </>
            )}
            <button
              className="primary-action"
              disabled={
                !editing ||
                !connections[platform] ||
                (["tiktok", "youtube"].includes(platform) && !privacy) ||
                (platform === "youtube" && !kids)
              }
              onClick={() => void publish()}
            >
              PUBLISH SAVED CAMPAIGN
            </button>
            <button
              onClick={() =>
                void task(async () => {
                  await navigator.clipboard.writeText(`${title}\n\n${body}`);
                  setNotice("Caption copied.");
                })
              }
            >
              COPY CAPTION
            </button>
            {asset && (
              <button
                onClick={() =>
                  void task(async () => {
                    const response = await fetch(`/api/admin/media/${asset}`);
                    if (!response.ok)
                      throw new Error("Unable to download media.");
                    const m = media.find((m) => m.id === asset)!;
                    download(
                      new File([await response.blob()], m.name, {
                        type: m.mime,
                      }),
                    );
                  })
                }
              >
                DOWNLOAD ATTACHMENT
              </button>
            )}
            <p className="admin-help">
              Exports and copy remain available before social accounts are
              connected. A submitted video may still be processing or restricted
              by the platform.
            </p>
          </div>
        </div>
      </fieldset>
      <h3>SAVED CAMPAIGNS & EVENTS</h3>
      <div className="business-cards">
        {content.map((c) => (
          <button
            disabled={busy || recording}
            className="studio-draft"
            key={c.id}
            onClick={() => open(c)}
          >
            <small>
              {c.kind.toUpperCase()} · {c.live ? "LIVE" : "DRAFT"}
            </small>
            <h3>{c.title}</h3>
            <span>
              {c.event_date || new Date(c.updated_at).toLocaleDateString()}
            </span>
          </button>
        ))}
        {!content.length && <p>Your saved work will appear here.</p>}
      </div>
      <h3>PUBLISHING LOG</h3>
      {posts.map((p) => (
        <div className="business-item" key={p.id}>
          <strong>
            {p.platform} · {p.status}
          </strong>
          <p>{p.detail || p.remote_id}</p>
          <small>{new Date(p.created_at).toLocaleString()}</small>
          {["unknown", "submitted"].includes(p.status) && (
            <button
              disabled={busy}
              onClick={() => {
                const note = window.prompt(
                  "Check this post on the platform first. Describe the verified outcome (at least 10 characters).",
                );
                if (!note) return;
                const published = window.confirm(
                  "Was it successfully published? OK = published; Cancel = confirmed failed (allows retry).",
                );
                void task(async () => {
                  await api(`/api/admin/social-posts/${p.id}/resolve`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                      status: published ? "published" : "failed",
                      note,
                    }),
                  });
                  await load();
                  setNotice("Publishing result updated.");
                });
              }}
            >
              RECONCILE VERIFIED OUTCOME
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  d: Row,
  source: HTMLImageElement | HTMLVideoElement | null,
  t: number,
) {
  const scale = Math.min(w, h) / 1080,
    pad = 80 * scale;
  ctx.fillStyle = "#0a1110";
  ctx.fillRect(0, 0, w, h);
  const sw =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : source?.naturalWidth || 0,
    sh =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : source?.naturalHeight || 0;
  if (source && sw && sh) {
    const zoom = Math.max(w / sw, h / sh) * (1 + Math.min(t, 12) * 0.002);
    ctx.drawImage(
      source,
      (w - sw * zoom) / 2,
      (h - sh * zoom) / 2,
      sw * zoom,
      sh * zoom,
    );
  }
  const shade = ctx.createLinearGradient(0, 0, w, h);
  shade.addColorStop(0, "rgba(3,12,10,.40)");
  shade.addColorStop(0.5, "rgba(3,12,10,.77)");
  shade.addColorStop(1, "rgba(3,12,10,.96)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(190,255,155,.09)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 80 * scale) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 80 * scale) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.fillStyle = d.accent;
  ctx.fillRect(pad, 70 * scale, 50 * scale, 8 * scale);
  ctx.font = `bold ${23 * scale}px Arial`;
  ctx.fillText("COMBATZONE SLU", pad + 70 * scale, 85 * scale);
  ctx.font = `${17 * scale}px monospace`;
  ctx.fillStyle = "#dbe6da";
  ctx.fillText("FIELD OPERATIONS / SAINT LUCIA", pad, 145 * scale);
  const portrait = h > w,
    headlineSize = (portrait ? 112 : 94) * scale;
  const lines = d.headline
    .split("\n")
    .flatMap((l: string) =>
      wrap(ctx, l, w - pad * 2, `900 ${headlineSize}px Arial`),
    );
  let y = portrait ? h * 0.4 : h * 0.34;
  lines.slice(0, 4).forEach((line: string, i: number) => {
    ctx.save();
    const progress = Math.max(0, Math.min(1, (t - i * 0.18) * 2));
    ctx.globalAlpha = progress;
    ctx.translate((1 - progress) * -80 * scale, 0);
    ctx.font = `900 ${headlineSize}px Arial`;
    ctx.fillStyle = i % 2 ? d.accent : "#ffffff";
    ctx.fillText(line, pad, y + i * headlineSize * 1.02, w - pad * 2);
    ctx.restore();
  });
  y += Math.min(lines.length, 4) * headlineSize * 1.02 + 25 * scale;
  ctx.font = `${30 * scale}px Arial`;
  ctx.fillStyle = "#e5ebe5";
  wrap(ctx, d.subtitle, w - pad * 2, ctx.font)
    .slice(0, 3)
    .forEach((line: string, i: number) =>
      ctx.fillText(line, pad, y + i * 42 * scale),
    );
  const bh = 82 * scale,
    by = h - (portrait ? 285 : 205) * scale;
  ctx.fillStyle = d.accent;
  ctx.beginPath();
  ctx.moveTo(pad, by);
  ctx.lineTo(w - pad, by);
  ctx.lineTo(w - pad - 20 * scale, by + bh);
  ctx.lineTo(pad, by + bh);
  ctx.fill();
  ctx.fillStyle = "#0a1110";
  ctx.font = `900 ${28 * scale}px Arial`;
  ctx.fillText(
    d.cta,
    pad + 25 * scale,
    by + 52 * scale,
    w - pad * 2 - 50 * scale,
  );
  ctx.font = `bold ${18 * scale}px Arial`;
  ctx.fillStyle = "#edf3ed";
  ctx.fillText(d.footer, pad, h - 90 * scale, w - pad * 2);
  ctx.strokeStyle = d.accent;
  ctx.lineWidth = 3 * scale;
  ctx.strokeRect(w - pad - 45 * scale, 65 * scale, 45 * scale, 45 * scale);
}
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  font: string,
) {
  ctx.font = font;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
