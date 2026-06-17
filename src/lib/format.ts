const KST_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const KST_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
});

const KST_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  hour: "numeric",
  minute: "2-digit",
});

export function formatKstDateTime(iso: string) {
  return `${KST_FORMATTER.format(new Date(iso))} KST`;
}

export function formatKstDate(iso: string) {
  return KST_DATE.format(new Date(iso));
}

export function formatKstTime(iso: string) {
  return `${KST_TIME.format(new Date(iso))} KST`;
}
