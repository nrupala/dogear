package app.getdogear;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Build H (D-10, second half): HTML is stripped to readable
 * text at the door. Markup must never survive into what is
 * stored, chunked and read aloud — the Build G failure was
 * a document read aloud as its own tags.
 */
public class HtmlTextTest {

    @Test
    public void markupNeverSurvives() {
        String out = HtmlText.strip(
                "<html><body><h1>Title</h1><p>Hello <b>bold</b> "
                        + "world.</p></body></html>");
        assertFalse(out.contains("<"));
        assertFalse(out.contains(">"));
        assertTrue(out.contains("Title"));
        assertTrue(out.contains("Hello bold world."));
    }

    @Test
    public void headScriptAndStyleAreDroppedWhole() {
        String out = HtmlText.strip(
                "<head><title>Tab title</title>"
                        + "<style>p { color: red; }</style></head>"
                        + "<body><script>var secret = 1;</script>"
                        + "<p>Visible prose.</p></body>");
        assertEquals("Visible prose.", out);
    }

    @Test
    public void commentsAreDropped() {
        String out = HtmlText.strip(
                "<p>Before.</p><!-- a note to no one --><p>After.</p>");
        assertFalse(out.contains("note to no one"));
        assertTrue(out.contains("Before."));
        assertTrue(out.contains("After."));
    }

    @Test
    public void blockStructureBecomesParagraphBreaks() {
        String out = HtmlText.strip(
                "<p>First paragraph.</p><p>Second paragraph.</p>"
                        + "<ul><li>One</li><li>Two</li></ul>");
        assertTrue(out.contains("First paragraph.\n\nSecond paragraph."));
        assertTrue(out.contains("One\n\nTwo"));
    }

    @Test
    public void entitiesDecodeToTheCharactersMeant() {
        String out = HtmlText.strip(
                "<p>Fish &amp; chips &lt;tag&gt; &quot;quoted&quot; "
                        + "&#8212; &#x2019;tis&nbsp;fine</p>");
        assertTrue(out.contains("Fish & chips"));
        assertTrue(out.contains("<tag>")); // decoded TEXT, not markup
        assertTrue(out.contains("\"quoted\""));
        assertTrue(out.contains("\u2014"));
        assertTrue(out.contains("\u2019tis fine"));
    }

    @Test
    public void anEscapedEntityStaysEscapedText() {
        // "&amp;lt;" in the source is the literal text "&lt;".
        String out = HtmlText.strip("<p>&amp;lt;</p>");
        assertEquals("&lt;", out);
    }

    /* Build I (D-16): the decoder is complete, not a
       hand-list. The L18 failure on Build H2 was &eacute;
       stored, displayed and spoken spelled out. This battery
       walks the classes: accented Latin-1 in both cases, the
       symbol and punctuation sets, Greek, and numeric forms —
       each spelled entity must come out as its character. */
    @Test
    public void theNamedEntityBatteryDecodes() {
        String[][] cases = {
                {"&eacute;", "é"}, {"&Eacute;", "É"},
                {"&egrave;", "è"}, {"&ecirc;", "ê"},
                {"&agrave;", "à"}, {"&Auml;", "Ä"},
                {"&ccedil;", "ç"}, {"&Ccedil;", "Ç"},
                {"&ntilde;", "ñ"}, {"&ouml;", "ö"},
                {"&uuml;", "ü"}, {"&szlig;", "ß"},
                {"&aelig;", "æ"}, {"&AElig;", "Æ"},
                {"&oslash;", "ø"}, {"&aring;", "å"},
                {"&oelig;", "œ"}, {"&scaron;", "š"},
                {"&yuml;", "ÿ"}, {"&eth;", "ð"},
                {"&THORN;", "Þ"}, {"&copy;", "©"},
                {"&reg;", "®"}, {"&trade;", "™"},
                {"&euro;", "€"}, {"&pound;", "£"},
                {"&yen;", "¥"}, {"&cent;", "¢"},
                {"&deg;", "°"}, {"&plusmn;", "±"},
                {"&middot;", "·"}, {"&para;", "¶"},
                {"&sect;", "§"}, {"&laquo;", "«"},
                {"&raquo;", "»"}, {"&frac14;", "¼"},
                {"&frac12;", "½"}, {"&frac34;", "¾"},
                {"&iexcl;", "¡"}, {"&iquest;", "¿"},
                {"&times;", "×"}, {"&divide;", "÷"},
                {"&ndash;", "–"}, {"&mdash;", "—"},
                {"&lsquo;", "‘"}, {"&rsquo;", "’"},
                {"&ldquo;", "“"}, {"&rdquo;", "”"},
                {"&hellip;", "…"}, {"&dagger;", "†"},
                {"&Dagger;", "‡"}, {"&permil;", "‰"},
                {"&prime;", "′"}, {"&Prime;", "″"},
                {"&bull;", "•"}, {"&alpha;", "α"},
                {"&Alpha;", "Α"}, {"&beta;", "β"},
                {"&pi;", "π"}, {"&Sigma;", "Σ"},
                {"&omega;", "ω"}, {"&Omega;", "Ω"},
                {"&infin;", "∞"}, {"&ne;", "≠"},
                {"&le;", "≤"}, {"&ge;", "≥"},
                {"&forall;", "∀"}, {"&isin;", "∈"},
                {"&sum;", "∑"}, {"&rarr;", "→"},
                {"&larr;", "←"}, {"&harr;", "↔"},
                {"&spades;", "♠"}, {"&hearts;", "♥"},
                {"&amp;", "&"},
                {"&lt;", "<"}, {"&gt;", ">"},
                {"&quot;", "\""}, {"&apos;", "'"},
        };
        for (String[] c : cases) {
            assertEquals("entity " + c[0], c[1],
                    HtmlText.strip("<p>" + c[0] + "</p>"));
        }
    }

    @Test
    public void numericReferencesDecodeInBothForms() {
        // &#233; and &#xE9; are both é; &#8212; is the em dash.
        assertEquals("café — café",
                HtmlText.strip("<p>caf&#233; &#8212; caf&#xE9;</p>"));
    }

    @Test
    public void aDecodedAmpersandStartsNoNewReference() {
        // One pass: "&#38;" is the character "&", and the
        // "lt;" after it is plain text — never a bracket.
        assertEquals("&lt;", HtmlText.strip("<p>&#38;lt;</p>"));
        assertEquals("&#65;", HtmlText.strip("<p>&amp;#65;</p>"));
    }

    @Test
    public void anUnknownEntityIsLeftAsWritten() {
        // Text is never silently dropped for being unlisted.
        assertEquals("a &notanentity; b",
                HtmlText.strip("<p>a &notanentity; b</p>"));
    }

    @Test
    public void entitiesDecodeInsideProse() {
        // The TESTER seat's L18 fixture shape, verbatim class:
        // the stored text must hold the character, not the name.
        String out = HtmlText.strip(
                "<p>The caf&eacute; owners along the quay ate "
                        + "cr&egrave;me br&ucirc;l&eacute;e.</p>");
        assertEquals("The café owners along the quay ate "
                + "crème brûlée.", out);
    }

    @Test
    public void plainTextPassesThroughUnchanged() {
        assertEquals("Just prose, no tags at all.",
                HtmlText.strip("Just prose, no tags at all."));
    }

    @Test
    public void emptyAndNullAreEmpty() {
        assertEquals("", HtmlText.strip(null));
        assertEquals("", HtmlText.strip("<script>only code</script>"));
        assertEquals("", HtmlText.strip("   "));
    }
}
