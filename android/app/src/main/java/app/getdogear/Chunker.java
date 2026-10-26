package app.getdogear;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * NativeFeeder's text source: splits a document's plain text into
 * speakable chunks using EXACTLY the chunking contract of the
 * pinned reader-core engine (vendor/reader-core-0.2.0,
 * reader-core.js), so the native surface and the web surface
 * divide the same document into the same pieces. This is a
 * contract re-implementation, validated by fixture vectors
 * generated from a transcription of the pinned source
 * (ChunkerTest) — reader-core is never forked; if the pin moves,
 * the vectors move and this class is re-validated against them.
 *
 * The contract, from the pinned source itself:
 *   - text is walked per block; each block's text is split into
 *     sentences on /(?<=[.!?])\s+/ (reader-core.js, sentence
 *     split); a sentence's text is whitespace-collapsed
 *     (\s+ -> " ") and trimmed; empty pieces are dropped;
 *   - chunks never span sentences; per sentence t, with
 *     chunkSize 240: while t.length > 240:
 *         c = t.lastIndexOf(',', 240); if c < 80: c = t.lastIndexOf(' ', 240);
 *         if c < 80: c = 240;
 *         push t.slice(0, c+1); t = t.slice(c+1) with leading
 *         whitespace stripped (/^\s+/);
 *     push the final t if non-empty. There is NO de-duplication:
 *     two identical sentences in a row are two chunks.
 *
 * The native input is a plain-text body, not a DOM: blocks are
 * the body's blank-line-separated paragraphs, each treated as
 * one text node — the same pieces the web ingest produces for a
 * text document.
 *
 * Java's String.lastIndexOf(int, int) and JS's
 * String.lastIndexOf(search, position) are both INCLUSIVE of the
 * position index, and both languages index strings in UTF-16
 * code units, so the arithmetic carries over exactly.
 */
public final class Chunker {

    public static final int CHUNK_SIZE = 240;
    private static final int MIN_CUT = 80;
    private static final Pattern SENTENCE_SPLIT =
            Pattern.compile("(?<=[.!?])\\s+");
    private static final Pattern WHITESPACE_RUN = Pattern.compile("\\s+");
    private static final Pattern BLOCK_SPLIT = Pattern.compile("\n\\s*\n");

    private Chunker() {}

    /** The engine's chunks for a document's full plain text. */
    public static List<String> chunksOf(String text) {
        List<String> out = new ArrayList<String>();
        if (text == null) return out;
        String normalized = text.replace("\r\n", "\n");
        for (String block : BLOCK_SPLIT.split(normalized)) {
            for (String part : SENTENCE_SPLIT.split(block)) {
                String s = WHITESPACE_RUN.matcher(part).replaceAll(" ").trim();
                if (s.isEmpty()) continue;
                String t = s;
                while (t.length() > CHUNK_SIZE) {
                    int c = t.lastIndexOf(',', CHUNK_SIZE);
                    if (c < MIN_CUT) c = t.lastIndexOf(' ', CHUNK_SIZE);
                    if (c < MIN_CUT) c = CHUNK_SIZE;
                    out.add(t.substring(0, c + 1));
                    t = stripLeadingWhitespace(t.substring(c + 1));
                }
                if (!t.isEmpty()) out.add(t);
            }
        }
        return out;
    }

    private static String stripLeadingWhitespace(String s) {
        int i = 0;
        while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        return s.substring(i);
    }
}
