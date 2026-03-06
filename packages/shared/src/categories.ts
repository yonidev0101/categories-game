import type { CategoryDefinition } from "./types";

export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  { id: "animal", label: "חי", description: "בעל חיים" },
  { id: "plant", label: "צומח", description: "צמח, עץ או פרח" },
  { id: "object", label: "דומם", description: "חפץ או דבר דומם" },
  { id: "boy", label: "ילד", description: "שם של בן" },
  { id: "girl", label: "ילדה", description: "שם של בת" },
  { id: "country", label: "ארץ", description: "שם של מדינה" },
  { id: "city", label: "עיר", description: "שם של עיר אמיתית" },
  { id: "job", label: "מקצוע", description: "מקצוע או עיסוק" }
];

export const HEBREW_LETTERS = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ", "ק", "ר", "ש", "ת"];
