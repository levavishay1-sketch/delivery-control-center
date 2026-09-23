/**
 * Turn an attached file into the text Claude reads.
 *
 * A requirement's real content is often in the attached spec, not in the
 * note next to it. Assess and breakdown send this text with the
 * requirement, so a file that was attached is a file that was read.
 *
 * What cannot be turned into text (an image, a zip, a binary) is not an
 * error — the file is still stored and still listed, and the prompt says
 * plainly that it exists and was not read, so nobody assumes it was.
 */

/** Beyond this the prompt stops being about the requirement. */
const MAX_CHARS = 120_000;

const PLAIN = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm",
  "yml", "yaml", "log", "sql", "cs", "ts", "js", "py", "java", "sh",
]);

export type Extraction = {
  /** The file's text, ready for a prompt. null ⇒ not readable as text. */
  text: string | null;
  /** Set when there is no text: why, in Hebrew, for the screen and the prompt. */
  reason: string | null;
};

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";

function clamp(s: string): string {
  const clean = s.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return clean.length <= MAX_CHARS
    ? clean
    : `${clean.slice(0, MAX_CHARS)}\n\n[הקובץ ארוך מ-${MAX_CHARS.toLocaleString("he-IL")} תווים — נקטע כאן]`;
}

export async function extractText(name: string, bytes: Buffer): Promise<Extraction> {
  const e = ext(name);
  try {
    if (PLAIN.has(e)) {
      const text = clamp(new TextDecoder("utf-8").decode(bytes));
      return text ? { text, reason: null } : { text: null, reason: "הקובץ ריק" };
    }
    if (e === "docx") {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      const text = clamp(value);
      return text ? { text, reason: null } : { text: null, reason: "המסמך ריק מטקסט" };
    }
    if (e === "pdf") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text: pages } = await pdfText(pdf, { mergePages: true });
      const text = clamp(Array.isArray(pages) ? pages.join("\n\n") : pages);
      return text
        ? { text, reason: null }
        : { text: null, reason: "ה-PDF סרוק כתמונה — אין בו טקסט לקריאה" };
    }
    return { text: null, reason: `סוג הקובץ (${e || "ללא סיומת"}) אינו נקרא כטקסט` };
  } catch (err) {
    return { text: null, reason: `קריאת הקובץ נכשלה: ${(err as Error).message}` };
  }
}
