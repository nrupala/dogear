package app.getdogear;

import java.util.HashMap;
import java.util.Map;
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
 *   - entities are decoded COMPLETELY (Build I, defect
 *     D-16): the full HTML named-entity set — the Latin-1 /
 *     accent class, Greek, symbols, punctuation — plus
 *     decimal and hex numeric references. Through Build H2
 *     the decoder was a hand-list of a dozen names, so a
 *     document's "caf&eacute;" was stored, displayed and
 *     SPOKEN with the entity still spelled out in it (the
 *     TESTER seat's L18 failure). Decoding is one pass: a
 *     reference the pass produces is never re-decoded, so
 *     "&amp;lt;" and "&amp;#65;" stay the literal text
 *     their authors wrote. A name the set does not know is
 *     left exactly as written — text is never silently
 *     dropped for being unlisted;
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
    private static final Pattern ENTITY = Pattern.compile(
            "&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|[a-zA-Z][a-zA-Z0-9]*);");
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

    /** One pass over every character reference in the text.
     *  Numeric references resolve by code point (an invalid
     *  one — zero, a surrogate, past the Unicode range —
     *  decodes to nothing, as before); named references
     *  resolve against NAMED, the complete HTML set; a name
     *  the set does not carry is copied through untouched.
     *  The scan never revisits its own replacements, which
     *  is what keeps "&amp;#65;" the literal text "&#65;". */
    private static String decodeEntities(String s) {
        Matcher m = ENTITY.matcher(s);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String body = m.group(1);
            String rep;
            if (body.charAt(0) == '#') {
                rep = numericReplacement(body.substring(1));
            } else {
                Integer cp = NAMED.get(body);
                rep = cp == null ? m.group(0)
                        : new String(Character.toChars(cp.intValue()));
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(rep));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String numericReplacement(String digits) {
        try {
            int cp = digits.startsWith("x") || digits.startsWith("X")
                    ? Integer.parseInt(digits.substring(1), 16)
                    : Integer.parseInt(digits, 10);
            return (cp > 0 && cp < 0x110000
                    && !(cp >= 0xD800 && cp <= 0xDFFF))
                    ? new String(Character.toChars(cp)) : "";
        } catch (Exception e) {
            return "";
        }
    }

    /** The named entities, complete: the five markup names
     *  (+ apos), the Latin-1 block (code points 160–255, the
     *  names in code-point order), the Latin Extended
     *  specials, Greek, and the symbol / punctuation set —
     *  the HTML 4.01 entity set, which is what the documents
     *  this app reads are written against. */
    private static final Map<String, Integer> NAMED = buildNamed();

    private static Map<String, Integer> buildNamed() {
        Map<String, Integer> map = new HashMap<String, Integer>();
        // The markup names (+ apos, from XHTML).
        map.put("quot", 34);
        map.put("amp", 38);
        map.put("apos", 39);
        map.put("lt", 60);
        map.put("gt", 62);
        // Latin-1: the names in strict code-point order,
        // 160 (nbsp) through 255 (yuml).
        String[] latin1 = {
                "nbsp", "iexcl", "cent", "pound", "curren", "yen",
                "brvbar", "sect", "uml", "copy", "ordf", "laquo",
                "not", "shy", "reg", "macr", "deg", "plusmn",
                "sup2", "sup3", "acute", "micro", "para", "middot",
                "cedil", "sup1", "ordm", "raquo", "frac14", "frac12",
                "frac34", "iquest", "Agrave", "Aacute", "Acirc",
                "Atilde", "Auml", "Aring", "AElig", "Ccedil",
                "Egrave", "Eacute", "Ecirc", "Euml", "Igrave",
                "Iacute", "Icirc", "Iuml", "ETH", "Ntilde",
                "Ograve", "Oacute", "Ocirc", "Otilde", "Ouml",
                "times", "Oslash", "Ugrave", "Uacute", "Ucirc",
                "Uuml", "Yacute", "THORN", "szlig", "agrave",
                "aacute", "acirc", "atilde", "auml", "aring",
                "aelig", "ccedil", "egrave", "eacute", "ecirc",
                "euml", "igrave", "iacute", "icirc", "iuml",
                "eth", "ntilde", "ograve", "oacute", "ocirc",
                "otilde", "ouml", "divide", "oslash", "ugrave",
                "uacute", "ucirc", "uuml", "yacute", "thorn",
                "yuml",
        };
        for (int i = 0; i < latin1.length; i++) {
            map.put(latin1[i], Integer.valueOf(160 + i));
        }
        // Latin Extended specials + general punctuation,
        // symbols, Greek, arrows, mathematics, suits.
        Object[] rest = {
                "OElig", 338, "oelig", 339, "Scaron", 352,
                "scaron", 353, "Yuml", 376, "fnof", 402,
                "circ", 710, "tilde", 732,
                "Alpha", 913, "Beta", 914, "Gamma", 915,
                "Delta", 916, "Epsilon", 917, "Zeta", 918,
                "Eta", 919, "Theta", 920, "Iota", 921,
                "Kappa", 922, "Lambda", 923, "Mu", 924,
                "Nu", 925, "Xi", 926, "Omicron", 927,
                "Pi", 928, "Rho", 929, "Sigma", 931,
                "Tau", 932, "Upsilon", 933, "Phi", 934,
                "Chi", 935, "Psi", 936, "Omega", 937,
                "alpha", 945, "beta", 946, "gamma", 947,
                "delta", 948, "epsilon", 949, "zeta", 950,
                "eta", 951, "theta", 952, "iota", 953,
                "kappa", 954, "lambda", 955, "mu", 956,
                "nu", 957, "xi", 958, "omicron", 959,
                "pi", 960, "rho", 961, "sigmaf", 962,
                "sigma", 963, "tau", 964, "upsilon", 965,
                "phi", 966, "chi", 967, "psi", 968,
                "omega", 969, "thetasym", 977, "upsih", 978,
                "piv", 982,
                "ensp", 8194, "emsp", 8195, "thinsp", 8201,
                "zwnj", 8204, "zwj", 8205, "lrm", 8206,
                "rlm", 8207, "ndash", 8211, "mdash", 8212,
                "lsquo", 8216, "rsquo", 8217, "sbquo", 8218,
                "ldquo", 8220, "rdquo", 8221, "bdquo", 8222,
                "dagger", 8224, "Dagger", 8225, "bull", 8226,
                "hellip", 8230, "permil", 8240, "prime", 8242,
                "Prime", 8243, "lsaquo", 8249, "rsaquo", 8250,
                "oline", 8254, "frasl", 8260, "euro", 8364,
                "image", 8465, "weierp", 8472, "real", 8476,
                "trade", 8482, "alefsym", 8501,
                "larr", 8592, "uarr", 8593, "rarr", 8594,
                "darr", 8595, "harr", 8596, "crarr", 8629,
                "lArr", 8656, "uArr", 8657, "rArr", 8658,
                "dArr", 8659, "hArr", 8660,
                "forall", 8704, "part", 8706, "exist", 8707,
                "empty", 8709, "nabla", 8711, "isin", 8712,
                "notin", 8713, "ni", 8715, "prod", 8719,
                "sum", 8721, "minus", 8722, "lowast", 8727,
                "radic", 8730, "prop", 8733, "infin", 8734,
                "ang", 8736, "and", 8743, "or", 8744,
                "cap", 8745, "cup", 8746, "int", 8747,
                "there4", 8756, "sim", 8764, "cong", 8773,
                "asymp", 8776, "ne", 8800, "equiv", 8801,
                "le", 8804, "ge", 8805, "sub", 8834,
                "sup", 8835, "nsub", 8836, "sube", 8838,
                "supe", 8839, "oplus", 8853, "otimes", 8855,
                "perp", 8869, "sdot", 8901,
                "lceil", 8968, "rceil", 8969, "lfloor", 8970,
                "rfloor", 8971, "lang", 9001, "rang", 9002,
                "loz", 9674, "spades", 9824, "clubs", 9827,
                "hearts", 9829, "diams", 9830,
        };
        for (int i = 0; i + 1 < rest.length; i += 2) {
            map.put((String) rest[i], (Integer) rest[i + 1]);
        }
        return map;
    }
}
