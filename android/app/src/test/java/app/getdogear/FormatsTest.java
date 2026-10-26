package app.getdogear;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Build H (D-10): the add path's format classification.
 * The advertised unlock set — PDF, EPUB, Word, HTML — must
 * classify as paid from the signals a real pick carries
 * (the file name's extension, the resolver's MIME type),
 * and plain text must never classify as paid.
 */
public class FormatsTest {

    @Test
    public void extensionsClassify() {
        assertEquals(Formats.Kind.HTML, Formats.kindFor("page.html", null));
        assertEquals(Formats.Kind.HTML, Formats.kindFor("page.HTM", null));
        assertEquals(Formats.Kind.HTML, Formats.kindFor("page.xhtml", null));
        assertEquals(Formats.Kind.PDF, Formats.kindFor("paper.pdf", null));
        assertEquals(Formats.Kind.EPUB, Formats.kindFor("book.epub", null));
        assertEquals(Formats.Kind.WORD, Formats.kindFor("doc.doc", null));
        assertEquals(Formats.Kind.WORD, Formats.kindFor("doc.docx", null));
        assertEquals(Formats.Kind.TEXT, Formats.kindFor("notes.txt", null));
        assertEquals(Formats.Kind.TEXT, Formats.kindFor("notes.md", "text/plain"));
    }

    @Test
    public void mimeClassifiesWhenTheNameDoesNot() {
        assertEquals(Formats.Kind.HTML,
                Formats.kindFor("download", "text/html"));
        assertEquals(Formats.Kind.PDF,
                Formats.kindFor("download", "application/pdf"));
        assertEquals(Formats.Kind.EPUB,
                Formats.kindFor("download", "application/epub+zip"));
        assertEquals(Formats.Kind.WORD, Formats.kindFor("download",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    }

    @Test
    public void theExtensionWinsOverTheMime() {
        // A .txt the resolver calls text/html is still the
        // user's text file; a .html is never smuggled past
        // the gate by a plain-text MIME claim.
        assertEquals(Formats.Kind.TEXT,
                Formats.kindFor("notes.txt", "text/html"));
        assertEquals(Formats.Kind.HTML,
                Formats.kindFor("page.html", "text/plain"));
    }

    @Test
    public void thePaidSetIsExactlyTheAdvertisedSet() {
        assertTrue(Formats.isPaid(Formats.Kind.HTML));
        assertTrue(Formats.isPaid(Formats.Kind.PDF));
        assertTrue(Formats.isPaid(Formats.Kind.EPUB));
        assertTrue(Formats.isPaid(Formats.Kind.WORD));
        assertFalse(Formats.isPaid(Formats.Kind.TEXT));
        assertFalse(Formats.isPaid(Formats.Kind.OTHER));
    }

    @Test
    public void unknownAndMissingNamesAreNotPaid() {
        assertEquals(Formats.Kind.OTHER, Formats.kindFor("archive.zip", null));
        assertEquals(Formats.Kind.OTHER, Formats.kindFor(null, null));
        assertEquals(Formats.Kind.TEXT, Formats.kindFor(null, "text/plain"));
    }
}
