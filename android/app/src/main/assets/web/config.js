// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar configuration — the ONE place product constants live.
 *
 * The Play product ids below are the contract with Play Console:
 * the store listing must create exactly these products, with these
 * meanings, before any purchase can succeed (see
 * ~/workspace/dogear/LICENSING-BUILD-NOTE.md for the Console setup
 * list). The unlock is a one-time, non-consumable product; the tips
 * are consumable. There is no subscription product, by the owner's
 * standing ruling.
 *
 * STRIPE_TIP_LINK: provisioned 2026-11-11 on the owner's order —
 * Stripe payment link plink_1UanUREAiA4GKFhARmaEu9kq for the
 * "DogEar Patron Tip" product (prod_Vc1XxQrfJGDgJ8), a FIXED
 * US$5 (Stripe payment links take no customer-set amount; a
 * $1/$3/$5 spread would be three links and a build change).
 * Read back active + livemode on the AIMLDS account and the
 * checkout page rendered before the fill. While the link is
 * empty the web app shows no tip link at all — never a dead
 * button; the Android app tips ride Play Billing instead.
 */
(function () {
  'use strict';

  window.DogEarConfig = {
    APP_VERSION: '1.7.0',

    /* The freemium model (owner's ruling, 2026-10-21, price set
       22:54 MDT; allowance retimed by the owner's ruling of
       2026-11-07): 60 free listening minutes per day — one hour a
       day — resetting at local midnight; a one-time US$24.99
       unlock, voice pack included. */
    FREE_MINUTES_PER_DAY: 60,
    UNLOCK_PRICE_LABEL: 'US$24.99',

    /* Content minutes are counted from the text itself: words
       divided by this rate. 160 wpm is ordinary read-aloud pace;
       the count is of CONTENT at 1x, so listening faster never
       burns the allowance faster. */
    WORDS_PER_MINUTE: 160,

    /* Play Billing via the Digital Goods API (TWA only). */
    PLAY_BILLING_METHOD: 'https://play.google.com/billing',
    SKUS: {
      unlock: 'dogear_unlock',
      tips: ['dogear_tip_1', 'dogear_tip_3', 'dogear_tip_5'],
      /* Reserved only. NOT priced, NOT sold, not referenced by
       * billing: the owner's ruling (2026-10-21 22:54 MDT) is that
       * the voice pack is INCLUDED in the unlock, not a separate
       * chargeable SKU. The key stays so a future owner decision
       * could name it without a code change. */
      voicePack: 'dogear_voice_pack',
    },

    /* Web tip link — provisioned 2026-11-11 (see header note). */
    STRIPE_TIP_LINK: 'https://buy.stripe.com/28E14n4ye104aP50Uu9Zm0o',

    /* Voice models — the optional, downloadable, fully on-device
     * two-way voice shelf (see src/voicepack.js). The listener
     * PICKS a model (Tiny / Base / Small / Medium / Large) and
     * downloads that one; all models share one runtime. Files are
     * versioned static assets under this base path, described by
     * <base>/pack-registry.json (written by build.py from
     * pack/PACK-REGISTRY.json); the Cache Storage name below is
     * what the service worker serves them from. NO model ships
     * inside the app: each model is downloaded by the user, under
     * that model's own licence, which the shelf shows before
     * download — speech recognition then runs on the device; no
     * audio ever leaves it. VOICE_PACK_MODEL_ID names only the
     * DEFAULT model (the recommended starting choice), never a
     * bundled one.
     *
     * Entitlement: the models ride the app's one unlocked state
     * (a Play unlock purchase or the owner's super-user licence).
     * `SKUS.voicePack` above reserves a standalone product ID,
     * but the owner's ruling (2026-10-21 22:54 MDT) is DECIDED:
     * voice is INCLUDED in the US$24.99 unlock — no price is
     * set for the pack SKU anywhere, and billing never uses it. */
    VOICE_PACK_BASE: '/pack/v2',
    VOICE_PACK_CACHE: 'dogear-voicepack-v2',
    VOICE_PACK_MODEL_ID: 'whisper-base.en',
    VOICE_PACK_MODEL_LABEL: 'Whisper (your choice of model)',
    /* The bundled studio TTS voice pack (Kokoro-82M, kind "tts"
     * on the same shelf). Unlike the recognition models above,
     * its download is FREE and never unlock-gated — it is the
     * default reading voice (spec item 7). voicepack.js treats
     * this id as a free model only while its registry entry also
     * carries gate:"free". */
    TTS_PACK_MODEL_ID: 'kokoro-82m-q8',
    TTS_PACK_MODEL_LABEL: 'DogEar voice pack',
  };
})();
