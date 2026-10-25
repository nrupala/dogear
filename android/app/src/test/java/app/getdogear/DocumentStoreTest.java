package app.getdogear;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The native library: add/list/remove/import over in-memory
 * storage (the same Storage seam the file implementation uses).
 */
public class DocumentStoreTest {

    private static final class Mem implements DocumentStore.Storage {
        final Map<String, String> map = new HashMap<String, String>();
        @Override public String read(String key) { return map.get(key); }
        @Override public void write(String key, String value) { map.put(key, value); }
        @Override public void delete(String key) { map.remove(key); }
    }

    @Test
    public void addListRemoveRoundTrip() {
        DocumentStore store = new DocumentStore(new Mem());
        assertTrue(store.isEmpty());
        DocumentStore.Doc a = store.add("", "text",
                "First line title.\nBody follows here.", 1000L);
        assertEquals("First line title.", a.title);
        DocumentStore.Doc b = store.add("Named", "text", "Other body.", 2000L);
        assertEquals(2, store.list().size());
        assertEquals("Other body.", store.bodyOf(b.id));
        store.remove(a.id);
        assertEquals(1, store.list().size());
        assertNull(store.bodyOf(a.id));
        assertNotNull(store.find(b.id));
    }

    @Test
    public void importKeepsExistingIdsAndSkipsDuplicates() {
        DocumentStore store = new DocumentStore(new Mem());
        DocumentStore.Doc d = store.importDoc("page-id-1", "Old Title",
                "text", "Migrated body.", 500L);
        assertNotNull(d);
        assertEquals("page-id-1", d.id);
        assertNull(store.importDoc("page-id-1", "Again", "text", "x", 600L));
        assertEquals(1, store.list().size());
    }

    @Test
    public void registrySurvivesAcrossInstances() {
        Mem mem = new Mem();
        DocumentStore one = new DocumentStore(mem);
        DocumentStore.Doc d = one.add("Persisted", "text", "Body.", 1L);
        DocumentStore two = new DocumentStore(mem);
        assertEquals(1, two.list().size());
        assertEquals(d.id, two.list().get(0).id);
    }

    @Test
    public void marksCascadeDeletesEverythingForADocument() {
        final StringBuilder held = new StringBuilder();
        MarksStore.Storage storage = new MarksStore.Storage() {
            @Override public String read() {
                return held.length() == 0 ? null : held.toString();
            }
            @Override public void write(String contents) {
                held.setLength(0);
                held.append(contents);
            }
        };
        MarksStore marks = new MarksStore(storage);
        marks.savePosition("docA", "A", 3, 10, false, 1L);
        marks.savePosition("docA", "A", 4, 10, true, 2L);
        marks.savePosition("docB", "B", 1, 5, false, 3L);
        marks.toggleFavorite("docA");
        marks.addBookmark("docA", 3, "bm", 4L);
        marks.addTag("docA", 3, "important", 5L);
        marks.addNote("docA", 3, "a note", 6L);
        marks.deleteDocument("docA");
        assertNull(marks.positionFor("docA"));
        assertNull(marks.savedFor("docA"));
        assertTrue(!marks.isFavorite("docA"));
        assertEquals(0, marks.marksFor("docA").optJSONArray("bookmarks").length());
        assertEquals(0, marks.marksFor("docA").optJSONArray("tags").length());
        assertEquals(0, marks.marksFor("docA").optJSONArray("notes").length());
        // The other document is untouched.
        assertNotNull(marks.positionFor("docB"));
    }
}
