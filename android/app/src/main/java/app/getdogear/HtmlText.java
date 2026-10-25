package app.getdogear;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HTML → the readable text inside it (Build H, from the
 * QUALITY seat's D-10: on the free tier an HTML file was read
 * aloud as raw markup, tags and all; on the unlocked tier the
 * same file must become a document, not a recitation of angle
 * brackets). This is the extraction half of that fix: the gate
 * decides WHETHER an HTML file may be added; this class
 * decides WHAT of it is a document.
 *
 * The rules, in order:
 *   - the head, scripts and styles are not the document —
 *     they are dropped whole, contents included;
 *   - block-level tags become paragraph breaks, so the
 *     chunker sees the author's own structure;
 *   - every remaining tag is removed;
 *   - entities are decoded (&amp;, &lt;, &gt;, &quot;,
 *     &apos;, &#39;, &nbsp;, and numeric forms);
 *   - whitespace is disciplined: runs of spaces collapse,
 *     three or more newlines become one paragraph break.
 *
 * Android-free, JVM-tested (HtmlTextTest): markup must never
 * survive into a chunk, and script/style text must never be
 * spoken.
 */
public final class HtmlText {

    private static final Pattern HEAD =
            Pattern.compile("<head\\b[^>]*>.*?</head\\s*>",
                    Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern SCRIPT =
            Pattern.compile("<script\\b[^>]*>.*?</script\\s*>",
                    Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern STYLE =
            Pattern.compile("<style\\b[^>]*>.*?</style\\s*>",
                    Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern COMMENT =
            Pattern.compile("<!--.*?-->", Pattern.DOTALL);
    private static final Pattern BLOCK_BREAK = Pattern.compile(
            "<\\s*/?\\s*(p|div|section|article|header|footer|main|aside"
                    + "|nav|h1|h2|h3|h4|h5|h6|ul|ol|li|table|thead|tbody"
                    + "|tr|blockquote|pre|figure|figcaption|hr)\\b[^>]*>",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern LINE_BREAK = Pattern.compile(
            "<\\s*br\\b[^>]*>", Pattern.CASE_INSENSITIVE);
    private static final Pattern CELL = Pattern.compile(
            "</\\s*(td|th)\\s*>", Pattern.CASE_INSENSITIVE);
    private static final Pattern ANY_TAG = Pattern.compile("<[^>]*>");
    private static final Pattern NUMERIC_ENTITY =
            Pattern.compile("&#(x?[0-9a-fA-F]+);");
    private static final Pattern SPACES = Pattern.compile("[ \\t\\x0B\\f]+");
    private static final Pattern MANY_NEWLINES = Pattern.compile("\\n{3,}");

    private HtmlText() {}

    /** The readable text of an HTML document. Null in, "" out —
     *  an HTML file with no readable text yields an empty
     *  string and the caller says so, honestly. */
    public static String strip(String html) {
        if (html == null) return "";
        String s = html;
        s = HEAD.matcher(s).replaceAll("\n");
        s = SCRIPT.matcher(s).replaceAll("");
        s = STYLE.matcher(s).replaceAll("");
        s = COMMENT.matcher(s).replaceAll("");
        s = BLOCK_BREAK.matcher(s).replaceAll("\n\n");
        s = LINE_BREAK.matcher(s).replaceAll("\n");
        s = CELL.matcher(s).replaceAll(" ");
        s = ANY_TAG.matcher(s).replaceAll("");
        s = decodeEntities(s);
        // Discipline: per-line space collapse, then paragraph
        // breaks normalize to exactly one blank line.
        String[] lines = s.split("\n", -1);
        StringBuilder out = new StringBuilder(s.length());
        for (String line : lines) {
            String clean = SPACES.matcher(line).replaceAll(" ").trim();
            out.append(clean).append('\n');
        }
        String joined = MANY_NEWLINES.matcher(out.toString())
                .replaceAll("\n\n");
        return joined.trim();
    }

    private static String decodeEntities(String s) {
        // Numeric forms FIRST: in "&amp;#65;" the "&" belongs
        // to &amp;, so no numeric entity exists there at all.
        Matcher m = NUMERIC_ENTITY.matcher(s);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String digits = m.group(1);
            try {
                int cp = digits.startsWith("x") || digits.startsWith("X")
                        ? Integer.parseInt(digits.substring(1), 16)
                        : Integer.parseInt(digits, 10);
                String rep = (cp > 0 && cp < 0x110000
                        && !(cp >= 0xD800 && cp <= 0xDFFF))
                        ? new String(Character.toChars(cp)) : "";
                m.appendReplacement(sb, Matcher.quoteReplacement(rep));
            } catch (Exception e) {
                m.appendReplacement(sb, "");
            }
        }
        m.appendTail(sb);
        // &amp; decodes LAST of the named set: "&amp;lt;" is the
        // literal text "&lt;", not a bracket.
        return sb.toString()
                .replace("&nbsp;", " ")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&apos;", "'")
                .replace("&rsquo;", "\u2019")
                .replace("&lsquo;", "\u2018")
                .replace("&rdquo;", "\u201D")
                .replace("&ldquo;", "\u201C")
                .replace("&hellip;", "\u2026")
                .replace("&mdash;", "\u2014")
                .replace("&ndash;", "\u2013")
                .replace("&amp;", "&");
    }
}
