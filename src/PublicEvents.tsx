import { useEffect, useState } from "react";
import "./business.css";
export default function PublicEvents() {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/events", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then(setEvents)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!events.length) return null;
  return (
    <section className="public-events" id="events">
      <p>YOUR NEXT MISSION</p>
      <h2>WHAT’S HAPPENING IN THE ZONE.</h2>
      <div className="public-event-grid">
        {events.map((e) => (
          <article key={e.id} className="public-event-card">
            {e.media_id &&
              (e.mime?.startsWith("video/") ? (
                <video
                  src={`/uploads/${e.media_id}`}
                  controls
                  preload="metadata"
                />
              ) : (
                <img
                  src={`/uploads/${e.media_id}`}
                  alt={e.title}
                  loading="lazy"
                />
              ))}
            <p>
              {new Date(e.event_date + "T12:00:00-04:00").toLocaleDateString(
                "en-GB",
                { dateStyle: "long", timeZone: "America/St_Lucia" },
              )}{" "}
              · {e.location}
            </p>
            <h3>{e.title}</h3>
            <p>{e.body}</p>
            <a href="/#booking">REQUEST YOUR MISSION →</a>
          </article>
        ))}
      </div>
    </section>
  );
}
