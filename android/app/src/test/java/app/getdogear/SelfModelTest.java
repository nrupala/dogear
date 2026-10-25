package app.getdogear;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The self-model router's discipline (ported from the web
 * build's R1 tests): fires only on questions ABOUT the app, and
 * document questions are never captured.
 */
public class SelfModelTest {

    @Test
    public void selfQuestionsRoute() {
        assertEquals("identity", SelfModel.match("What is this app?"));
        assertEquals("identity", SelfModel.match("tell me about yourself"));
        assertEquals("controls", SelfModel.match("What do the buttons do?"));
        assertEquals("talk", SelfModel.match("How does Talk work?"));
        assertEquals("shelf", SelfModel.match("Tell me about the voice models"));
        assertEquals("plan", SelfModel.match("How much does the unlock cost?"));
        assertEquals("limits", SelfModel.match("What can't you do?"));
        assertEquals("help", SelfModel.match("help"));
    }

    @Test
    public void documentQuestionsAreNotCaptured() {
        assertNull(SelfModel.match("what does the book say about the price of copper"));
        assertNull(SelfModel.match("how much did the bridge cost"));
        assertNull(SelfModel.match("tell me about the author"));
        assertNull(SelfModel.match("what is the capital of France"));
        assertNull(SelfModel.match(""));
    }

    @Test
    public void answersCarryTheSettledNumbers() {
        SelfModel.Ctx ctx = new SelfModel.Ctx();
        String plan = SelfModel.answerFor("plan", ctx);
        assertTrue(plan.contains("600"));
        assertTrue(plan.contains("US$24.99"));
        ctx.unlocked = true;
        assertTrue(SelfModel.answerFor("plan", ctx).contains("unlimited"));
    }
}
