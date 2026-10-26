package app.getdogear;

import java.util.Locale;

/**
 * The Add path's format truth (Build H, from the QUALITY
 * seat's D-10). Help & About advertises a set of formats as
 * part of the unlock — PDF, EPUB, Word and HTML. On Build G
 * the native picker admitted HTML as if it were plain text:
 * no gate on the free tier, and the markup itself was read
 * aloud. This class is the classifier every add decision now
 * goes through: what a picked file IS (from its name and its
 * MIME type), and whether that kind belongs to the advertised
 * paid set. Android-free so the classification is JVM-tested;
 * the host (MainActivity) owns the consequences — gate, strip,
 * or plain-text ingest.
 */
public final class Formats {

    public enum Kind { TEXT, HTML, PDF, EPUB, WORD, OTHER }

    private Formats() {}

    /** Classify a picked file. The extension wins when it
     *  speaks (a provider's MIME labels are not always honest);
     *  the MIME type decides when the name is silent. */
    public static Kind kindFor(String displayName, String mimeType) {
        String ext = extensionOf(displayName);
        if ("html".equals(ext) || "htm".equals(ext)
                || "xhtml".equals(ext)) return Kind.HTML;
        if ("pdf".equals(ext)) return Kind.PDF;
        if ("epub".equals(ext)) return Kind.EPUB;
        if ("doc".equals(ext) || "docx".equals(ext)) return Kind.WORD;
        if ("txt".equals(ext) || "md".equals(ext)
                || "markdown".equals(ext) || "text".equals(ext)) {
            return Kind.TEXT;
        }
        String mime = mimeType == null ? "" : mimeType.toLowerCase(Locale.US);
        if ("text/html".equals(mime) || "application/xhtml+xml".equals(mime)) {
            return Kind.HTML;
        }
        if ("application/pdf".equals(mime)) return Kind.PDF;
        if ("application/epub+zip".equals(mime)) return Kind.EPUB;
        if ("application/msword".equals(mime)
                || mime.contains("wordprocessingml")) return Kind.WORD;
        if (mime.startsWith("text/")) return Kind.TEXT;
        return Kind.OTHER;
    }

    /** The advertised unlock set: these formats meet the gate
     *  on the free tier, exactly as Help & About promises. */
    public static boolean isPaid(Kind kind) {
        return kind == Kind.HTML || kind == Kind.PDF
                || kind == Kind.EPUB || kind == Kind.WORD;
    }

    /** The word the surface uses for a format (dialogs name
     *  what was actually picked — never a generic "file"). */
    public static String label(Kind kind) {
        switch (kind) {
            case HTML: return "HTML";
            case PDF: return "PDF";
            case EPUB: return "EPUB";
            case WORD: return "Word";
            case TEXT: return "text";
            default: return "file";
        }
    }

    static String extensionOf(String displayName) {
        if (displayName == null) return "";
        String name = displayName.trim().toLowerCase(Locale.US);
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        return name.substring(dot + 1);
    }
}
