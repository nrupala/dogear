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
