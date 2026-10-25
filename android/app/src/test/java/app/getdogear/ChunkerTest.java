package app.getdogear;

import static org.junit.Assert.assertEquals;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The native chunker against fixture vectors generated from a
 * transcription of the pinned reader-core 0.2.0 source
 * (chunker-vectors.json). If the engine pin moves, regenerate
 * the vectors from the new pin and this test is the re-proof.
 */
public class ChunkerTest {

    private JSONObject vectors() throws Exception {
        InputStream in = getClass().getResourceAsStream("/chunker-vectors.json");
        StringBuilder sb = new StringBuilder();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
            sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
        }
        in.close();
        return new JSONObject(sb.toString());
    }

    @Test
    public void matchesPinnedEngineOnEveryFixture() throws Exception {
        JSONObject all = vectors();
        JSONObject fixtures = all.getJSONObject("fixtures");
        JSONObject expected = all.getJSONObject("expected");
        JSONArray names = fixtures.names();
        for (int i = 0; i < names.length(); i++) {
            String name = names.getString(i);
            List<String> want = new ArrayList<String>();
            JSONArray arr = expected.getJSONArray(name);
            for (int j = 0; j < arr.length(); j++) want.add(arr.getString(j));
            List<String> got = Chunker.chunksOf(fixtures.getString(name));
            assertEquals("fixture " + name, want, got);
        }
    }

    @Test
    public void identicalSentencesAreNotDeduplicated() {
        // The pinned engine has no dedupe: a repeated sentence is
        // a repeated chunk (the reader highlights each in turn).
        List<String> chunks = Chunker.chunksOf("Same line. Same line.");
        assertEquals(2, chunks.size());
    }

    @Test
    public void emptyAndNullYieldNoChunks() {
        assertEquals(0, Chunker.chunksOf("").size());
        assertEquals(0, Chunker.chunksOf(null).size());
        assertEquals(0, Chunker.chunksOf("  \n\n  ").size());
    }
}
