export function visitId() {
  try {
    if (
      navigator.doNotTrack === "1" ||
      localStorage.getItem("cz-analytics-optout") === "1"
    )
      return "";
    let id = sessionStorage.getItem("cz-visit");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("cz-visit", id);
    }
    return id;
  } catch {
    return "";
  }
}
export function campaignId() {
  try {
    const incoming = new URLSearchParams(location.search).get("campaign");
    if (incoming && /^[a-f\d-]{36}$/i.test(incoming))
      sessionStorage.setItem("cz-campaign", incoming);
    return sessionStorage.getItem("cz-campaign") || "";
  } catch {
    return "";
  }
}
export function track(event: "landing" | "booking_started") {
  const id = visitId();
  campaignId();
  if (!id) return;
  void fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, visitId: id }),
    keepalive: true,
  }).catch(() => {});
}
