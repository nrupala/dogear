package app.getdogear;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The R3 census as a test, native edition: every failure class
 * the Talk loop can meet has a line, and every line carries a
 * cause AND a remedy shape (never bare, never raw).
 */
public class FailureSpeechTest {

    @Test
    public void everyClassHasAnElaboratedLine() {
        String[] classes = FailureSpeech.classes();
        assertTrue("census is populated", classes.length >= 10);
        for (String cls : classes) {
            String line = FailureSpeech.lineFor(cls);
            assertNotNull("line for " + cls, line);
            assertTrue("line for " + cls + " is elaborated, not bare",
                    line.length() >= 40);
            assertTrue("line for " + cls + " leaks no raw placeholder",
                    !line.contains("(NAME)") && !line.contains("Exception")
                            && !line.contains("null"));
        }
    }

    @Test
    public void micClassesStaySeparate() {
        // Doctrine: never conflate mic classes — permission,
        // busy and absent are different sentences.
        String perm = FailureSpeech.lineFor(FailureSpeech.CAPTURE_PERMISSION);
        String busy = FailureSpeech.lineFor(FailureSpeech.CAPTURE_BUSY);
        String none = FailureSpeech.lineFor(FailureSpeech.CAPTURE_NONE);
        assertTrue(perm.contains("permission"));
        assertTrue(busy.contains("busy"));
        assertTrue(none.contains("No microphone"));
        assertTrue(!perm.equals(busy) && !busy.equals(none));
    }

    @Test
    public void unknownClassFallsBackToAnElaboratedLine() {
        String line = FailureSpeech.lineFor("some-future-class");
        assertNotNull(line);
        assertTrue(line.length() >= 40);
    }
}
