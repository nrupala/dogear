package app.getdogear;

import java.util.regex.Pattern;

/**
 * The app's knowledge of itself, native (redesign FUNCTION; the
 * R1 self-model ported from the web build's selfmodel.js — the
 * CONTENT is kept, per the brief's keep/rebuild ledger; the
 * surface references are re-truthed for the native app: the shelf
 * lives in Settings, the bar sits under the document in Listen,
 * a Now Listening strip stands over the Library, and marks live
 * behind the Marks button, in the Marks sheet (Build E)).
 *
 * Routing discipline, unchanged from the source: match() fires
 * only on question-shaped utterances ABOUT the app. Document
 * questions must NOT be captured — SelfModelTest holds that line
 * ("what does the book say about the price of copper" returns
 * null). Voice commands never reach match() — the router checks
 * them first.
 */
public final class SelfModel {

    /** The caller's live truth, composed in — never assumed. */
    public static final class Ctx {
        public boolean unlocked;
        public boolean modelInstalled;
        public int freeMinutes = 600;
        public String priceLabel = "US$24.99";
    }

    private static final String[][] TOPIC_PATTERNS = {
            {"controls",
                    "\\b(what|how) .*\\b(buttons?|controls?)\\b",
                    "\\bwhat (do|does) the (buttons?|controls?) do\\b",
                    "\\bhow do i (pause|stop|save|bookmark|mark|take a note|make a note|continue)\\b",
                    "\\b(the )?control bar\\b"},
            {"talk",
                    "\\bhow (do i|does) (talk|talking)\\b",
                    "\\bhow does talk work\\b",
                    "\\bhow do i (ask|talk to) (you|dogear|the app)\\b",
                    "\\bcan i talk to you\\b",
                    "\\bhow do i ask (you )?(a question|something)\\b"},
            {"shelf",
                    "\\b(voice|speech) models?\\b",
                    "\\bwhisper\\b",
                    "\\bwhich model\\b",
                    "\\bthe (model )?shelf\\b",
                    "\\bwhy (can't|cannot|can i not) i (use|download) (the )?(small|medium|large)\\b",
                    "\\b(small|medium|large) model\\b"},
            {"plan",
                    "\\bhow much (is|does) (dogear|this app|the app|the unlock)\\b",
                    "\\bwhat does the unlock (cost|include|give)\\b",
                    "\\bwhat do i get (for|with|when i) (unlock|paying|the unlock)\\b",
                    "\\bis (dogear|this app|it) free\\b",
                    "\\b(free|unlock|subscription|pay|price|cost).*\\b(dogear|this app|the app|unlock)\\b",
                    "\\bhow much do i (have to )?pay\\b"},
            {"limits",
                    "\\bwhat can('t|not) you do\\b",
                    "\\byour (limits|limitations)\\b",
                    "\\bwake word\\b",
                    "\\bdo you (make up|invent|compose) answers\\b"},
            {"identity",
                    "\\bwhat (is|are) (this app|dogear|you)\\b",
                    "\\bwho (are you|made (this|dogear)|built (this|dogear))\\b",
                    "\\btell me about (yourself|this app|dogear|the app)\\b",
                    "\\bwhat (can|do) you do\\b",
                    "\\bwhat is this (app|thing) (for|about)\\b",
                    "\\bhow does (this app|dogear|it) work\\b",
                    "\\bdescribe (yourself|this app|dogear)\\b",
                    "\\bexplain (yourself|this app|what you are)\\b"},
            {"help",
                    "^help( me)?$",
                    "\\bhow do i use (this|dogear|the app)\\b",
                    "\\bwhat can i ask( you)?\\b",
                    "\\bhow do i (get started|start)\\b"},
    };

    private static final Pattern[][] COMPILED = compile();

    private static Pattern[][] compile() {
        Pattern[][] out = new Pattern[TOPIC_PATTERNS.length][];
        for (int i = 0; i < TOPIC_PATTERNS.length; i++) {
            out[i] = new Pattern[TOPIC_PATTERNS[i].length - 1];
            for (int j = 1; j < TOPIC_PATTERNS[i].length; j++) {
                out[i][j - 1] = Pattern.compile(TOPIC_PATTERNS[i][j]);
            }
        }
        return out;
    }

    private SelfModel() {}

    static String norm(String text) {
        String t = text == null ? "" : text.toLowerCase().trim();
        t = t.replaceFirst("^(hey|ok|okay|please)[,.\\s]+", "");
        t = t.replaceAll("[.!?\\s]+$", "").trim();
        return t;
    }

    /** The topic an utterance asks about, or null — null is the
     *  common case and means "not about the app; route on". */
    public static String match(String text) {
        String t = norm(text);
        if (t.isEmpty()) return null;
        for (int i = 0; i < TOPIC_PATTERNS.length; i++) {
            for (Pattern p : COMPILED[i]) {
                if (p.matcher(t).find()) return TOPIC_PATTERNS[i][0];
            }
        }
        return null;
    }

    public static String answerFor(String topic, Ctx ctx) {
        if (ctx == null) ctx = new Ctx();
        if ("controls".equals(topic)) return controls();
        if ("talk".equals(topic)) return talk(ctx);
        if ("shelf".equals(topic)) return shelf();
        if ("plan".equals(topic)) return plan(ctx);
        if ("limits".equals(topic)) return limits();
        if ("help".equals(topic)) return help();
        return identity();
    }

    private static String identity() {
        return "I am DogEar. I read your documents aloud \u2014 "
                + "articles, notes, books and files \u2014 in your device\u2019s "
                + "own voice, and I keep your place so you can pick up "
                + "where you stopped. Your documents live only on this "
                + "device: there is no DogEar account, and nothing about "
                + "your reading is tracked or sent anywhere. You can "
                + "listen with the buttons, or unlock two-way voice and "
                + "talk to me. Ask me what the buttons do, how Talk "
                + "works, about the voice models, or what the unlock "
                + "includes.";
    }

    private static String controls() {
        return "Listening is controlled in two places, and both "
                + "work while I am speaking. Above the Library, the "
                + "Now Listening strip shows what is open, which part "
                + "you are on, and how much listening is left: its big "
                + "button pauses and resumes, and its Talk button "
                + "reaches me from anywhere. In the document itself, "
                + "the control bar sits under the text: Play and Pause "
                + "start and hold the reading, Stop stops it and keeps "
                + "your place, and Continue picks up from your saved "
                + "place. Below those, the Marks button opens the "
                + "Marks sheet: Save place pins where you are, so "
                + "Continue returns there even if you read on, and "
                + "Bookmark, Favorite, Tag and Note each mark the part "
                + "that is sounding when you press. Every mark you "
                + "save is listed in that same sheet \u2014 tap one, and "
                + "I jump to its place. Talk is how you speak to me "
                + "\u2014 ask me how Talk works, and I will explain it.";
    }

    private static String talk(Ctx ctx) {
        return "Press Talk, and I stop speaking first \u2014 the "
                + "microphone never opens over my own voice. Then say a "
                + "command, like pause, go back or start over, or ask a "
                + "question about the document you have open. I work out "
                + "what you said on this device; your voice is never "
                + "uploaded. Listening lasts up to twenty seconds \u2014 tap "
                + "Talk again when you are done. About a document, I "
                + "answer by quoting it: I read you its own words, I do "
                + "not make answers up, and when the document does not "
                + "answer, I say so and tell you why."
                + (ctx.modelInstalled
                        ? ""
                        : " One thing first: Talk needs a speech model from "
                        + "the voice shelf \u2014 pick one in Settings, under "
                        + "Voice pack, and download it once, and then Talk "
                        + "works.");
    }

    private static String shelf() {
        return "Two-way voice needs a speech model, and you "
                + "choose it. The voice shelf in Settings offers five "
                + "Whisper models \u2014 Tiny, Base, Small, Medium and "
                + "Large \u2014 each with its size shown before you "
                + "download anything, and each under its own licence. "
                + "Nothing is bundled with the app: the model you pick "
                + "downloads once, together with the shared runtime, and "
                + "then listens entirely on this device. Tiny and Base "
                + "run in the app today, and Base is the recommended "
                + "starting point. Small, Medium and Large are not "
                + "offered yet: they need more memory than the in-app "
                + "engine can safely use, and the phone would shut "
                + "DogEar down while loading them. They return when the "
                + "stronger engine lands.";
    }

    private static String plan(Ctx ctx) {
        if (ctx.unlocked) {
            return "You have the DogEar unlock on this device, so "
                    + "listening here is unlimited, the document formats "
                    + "are open, and two-way voice is yours \u2014 the free "
                    + "monthly minutes no longer apply to you. For anyone "
                    + "on the free plan: every month includes " + ctx.freeMinutes
                    + " minutes of listening free, and the unlock is one "
                    + "payment of " + ctx.priceLabel + " \u2014 never a subscription.";
        }
        return "Every month includes " + ctx.freeMinutes + " minutes of "
                + "listening free \u2014 ten hours. Listening is counted by "
                + "the document, not the clock: hearing a passage again "
                + "costs nothing, and a document you have started can "
                + "always be finished. One payment of " + ctx.priceLabel
                + " unlocks DogEar for good: unlimited listening, the "
                + "PDF, EPUB, Word and HTML formats, and two-way voice "
                + "with the model shelf included. There is no "
                + "subscription, and there never will be.";
    }

    private static String limits() {
        return "Honestly, my limits. I have no wake word \u2014 I "
                + "only listen when you press Talk. I do not compose "
                + "answers: about a document I can only quote it, and "
                + "about myself I can only tell you what is built in. "
                + "The three largest voice models are held back until a "
                + "stronger engine lands, because the phone would shut "
                + "me down loading them. And my reading voice is your "
                + "device\u2019s own voice \u2014 if this device has no usable "
                + "voice, I will say so on screen instead of pretending "
                + "to speak.";
    }

    private static String help() {
        return "Here is what you can ask me. Ask what I am, and "
                + "I will introduce myself. Ask what the buttons do, how "
                + "Talk works, about the voice models, or what the "
                + "unlock includes. While a document is open, you can "
                + "also ask me about the document \u2014 I answer from its "
                + "own words. Or just say a command: pause, resume, go "
                + "back, start over, stop.";
    }
}
