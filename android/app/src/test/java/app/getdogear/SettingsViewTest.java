package app.getdogear;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

/**
 * Voice presentation (Build J, Q-I3). Through Build I a voice's
 * label ended with its variant CODE — "English (United
 * States) · on device · SFG" — three letters that mean nothing
 * to the person choosing the voice that will read to them, on a
 * primary surface (two seats flagged it; Wright's Build I
 * acceptance of the codes is superseded). The label now carries
 * words only, and voices that share a label are told apart by
 * a word: the engine's own feature word when it offers
 * distinct ones, ordinal words when it does not. The engine
 * name itself — the identity — lives behind Details.
 */
public class SettingsViewTest {

    @Test
    public void labelsCarryNoVariantCode() {
        assertEquals("English (United States) \u00B7 on device",
                SettingsView.voiceLabel("en-us-x-sfg-local",
                        "English (United States)"));
        assertEquals("English (United States) \u00B7 online",
                SettingsView.voiceLabel("en-us-x-sfg-network",
                        "English (United States)"));
        assertFalse(SettingsView.voiceLabel("ar-xa-x-arc-local",
                "Arabic").contains("ARC"));
    }

    @Test
    public void sameNameVoicesGetTheirFeatureWords() {
        List<SettingsView.VoiceInfo> in = Arrays.asList(
                new SettingsView.VoiceInfo("ar-eg-x-a-local",
                        "Arabic (Egypt) \u00B7 on device", "female"),
                new SettingsView.VoiceInfo("ar-eg-x-b-local",
                        "Arabic (Egypt) \u00B7 on device", "male"),
                new SettingsView.VoiceInfo("en-us-x-a-local",
                        "English (United States) \u00B7 on device", ""));
        List<SettingsView.VoiceInfo> out = SettingsView.disambiguated(in);
        assertEquals("Arabic (Egypt) \u00B7 on device \u00B7 Female",
                out.get(0).label);
        assertEquals("Arabic (Egypt) \u00B7 on device \u00B7 Male",
                out.get(1).label);
        // A label nobody shares stands untouched.
        assertEquals("English (United States) \u00B7 on device",
                out.get(2).label);
    }

    @Test
    public void sameNameVoicesWithoutFeaturesGetOrdinalWords() {
        List<SettingsView.VoiceInfo> in = Arrays.asList(
                new SettingsView.VoiceInfo("ar-xa-x-arc-local",
                        "Arabic \u00B7 on device", ""),
                new SettingsView.VoiceInfo("ar-xa-x-ard-local",
                        "Arabic \u00B7 on device", ""),
                new SettingsView.VoiceInfo("ar-xa-x-are-local",
                        "Arabic \u00B7 on device", ""));
        List<SettingsView.VoiceInfo> out = SettingsView.disambiguated(in);
        assertEquals("Arabic \u00B7 on device \u00B7 voice one", out.get(0).label);
        assertEquals("Arabic \u00B7 on device \u00B7 voice two", out.get(1).label);
        assertEquals("Arabic \u00B7 on device \u00B7 voice three", out.get(2).label);
    }

    @Test
    public void collidingFeatureWordsFallBackToOrdinals() {
        // Two voices offering the SAME word cannot be told apart
        // by it — the ordinal path takes the whole group.
        List<SettingsView.VoiceInfo> in = Arrays.asList(
                new SettingsView.VoiceInfo("a", "Hindi \u00B7 on device", "female"),
                new SettingsView.VoiceInfo("b", "Hindi \u00B7 on device", "female"));
        List<SettingsView.VoiceInfo> out = SettingsView.disambiguated(in);
        assertEquals("Hindi \u00B7 on device \u00B7 voice one", out.get(0).label);
        assertEquals("Hindi \u00B7 on device \u00B7 voice two", out.get(1).label);
    }
}
