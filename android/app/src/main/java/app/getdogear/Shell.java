package app.getdogear;

/**
 * What the three area views may ask of their host (MainActivity):
 * navigation, the document actions, and the shared stores. The
 * views render and collect intent; every state change lands in
 * the core or the stores, never in a view (Phase 0 rule, clause
 * 1 — no view owns truth).
 */
public interface Shell {
    int AREA_LISTEN = 0;
    int AREA_LIBRARY = 1;
    int AREA_SETTINGS = 2;

    void showArea(int area);

    /** Open a document natively (session set by native code) and
     *  show Listen. */
    void openDocument(String docId);

    /** The Add flow's file route (SAF picker, hosted by the
     *  activity for its result contract). */
    void pickDocumentFile();

    /** The Add flow's paste route: title may be empty (derived). */
    void addPastedText(String title, String text);

    /** Remove, whole: playback stop if it is the open document,
     *  the document, its place and its marks. The view confirms
     *  with the user first, in the brief's words. */
    void removeDocument(String docId);

    /** Steer the open document to a chunk (tap-a-paragraph, and
     *  the voice steering verbs): re-seed the session at the
     *  chunk; if reading was underway, feeding restarts there. */
    void steerToChunk(int chunk);

    void setSpeechRate(float rate);

    void setSpeechVoice(String voiceName);

    PlayerCore core();

    DocumentStore documents();

    MarksStore marks();

    Licence licence();

    EngineHost engineHost();

    float speechRate();

    String speechLang();
}
