const APP_TIME_ZONE = "America/Phoenix";

export function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value || "";
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  const dayPeriod = part("dayPeriod");

  if (!month || !day || !hour || !minute || !dayPeriod) return "Not recorded";
  return `${month} ${day}, ${hour}:${minute} ${dayPeriod}`;
}
