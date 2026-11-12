// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar self-model — the app can talk about itself
 * (beta.6 voice-quality program, VOICE-QUALITY-BETA6.md, R1).
 *
 * Before beta.6 the ask loop had exactly two knowledge
 * sources — voice commands and the open document — and the
 * app was not one of them: "what is this app / tell me about
 * yourself" was searched for in whatever book was open, and
 * refused or misquoted out of it. This module is the third
 * source: a built-in, truthful self-description the voice
 * layer can speak, in sections the router selects.
 *
 * Truth discipline (the Profile-Truth rule, applied to the
 * product itself): every sentence here is checked against the
 * shipped build — config.js constants for the numbers, the
 * native control bar's real buttons for the controls,
 * voicepack's gate reason for the shelf, the About page's own
 * claims for the rest. Where a fact can vary (locked vs
 * unlocked, app vs browser surface, whether a model is
 * installed), the answer is composed from the caller's
 * context, never assumed. Nothing is promised that the build
 * does not do: no wake word, no composed answers about
 * documents, no ungated models.
 *
 * Routing discipline: match() is deliberately narrow. It
 * fires only on question-shaped utterances ABOUT the app
 * (the app / DogEar / yourself / the buttons / Talk / the
 * models / the unlock, named or clearly meant). Document
 * questions must NOT be captured: "what does the book say
 * about the price of copper", "how much did the bridge cost",
 * "tell me about the author" all return null here and reach
 * the document path, and the tests hold that line. Voice
 * commands never reach match() — the host checks them first.
 */
(function () {
  'use strict';

  function norm(text) {
    var t = String(text || '').toLowerCase().trim();
    t = t.replace(/^(hey|ok|okay|please)[,.\s]+/, '');
    t = t.replace(/[.!?\s]+$/, '').trim();
    return t;
  }

  /* Topic patterns, checked in order. Each is anchored to
     self-reference; a bare topic word (price, model, chapter)
     is never enough. */
  var TOPICS = [
    ['controls', [
      /\b(what|how) .*\b(buttons?|controls?)\b/,
      /\bwhat (do|does) the (buttons?|controls?) do\b/,
      /\bhow do i (pause|stop|save|bookmark|mark|take a note|make a note|continue)\b/,
      /\b(the )?control bar\b/,
    ]],
    ['talk', [
      /\bhow (do i|does) (talk|talking)\b/,
      /\bhow does talk work\b/,
      /\bhow do i (ask|talk to) (you|dogear|the app)\b/,
      /\bcan i talk to you\b/,
      /\bhow do i ask (you )?(a question|something)\b/,
    ]],
    ['shelf', [
      /\b(voice|speech) models?\b/,
      /\bwhisper\b/,
      /\bwhich model\b/,
      /\bthe (model )?shelf\b/,
      /\bwhy (can't|cannot|can i not) i (use|download) (the )?(small|medium|large)\b/,
      /\b(small|medium|large) model\b/,
    ]],
    ['plan', [
      /\bhow much (is|does) (dogear|this app|the app|the unlock)\b/,
      /\bwhat does the unlock (cost|include|give)\b/,
      /\bwhat do i get (for|with|when i) (unlock|paying|the unlock)\b/,
      /\bis (dogear|this app|it) free\b/,
      /\b(free|unlock|subscription|pay|price|cost).*\b(dogear|this app|the app|unlock)\b/,
      /\bhow much do i (have to )?pay\b/,
    ]],
    ['limits', [
      /\bwhat can('t|not) you do\b/,
      /\byour (limits|limitations)\b/,
      /\bwake word\b/,
      /\bdo you (make up|invent|compose) answers\b/,
    ]],
    ['identity', [
      /\bwhat (is|are) (this app|dogear|you)\b/,
      /\bwho (are you|made (this|dogear)|built (this|dogear))\b/,
      /\btell me about (yourself|this app|dogear|the app)\b/,
      /\bwhat (can|do) you do\b/,
      /\bwhat is this (app|thing) (for|about)\b/,
      /\bhow does (this app|dogear|it) work\b/,
      /\bdescribe (yourself|this app|dogear)\b/,
      /\bexplain (yourself|this app|what you are)\b/,
    ]],
    ['help', [
      /^help( me)?$/,
      /\bhow do i use (this|dogear|the app)\b/,
      /\bwhat can i ask( you)?\b/,
      /\bhow do i (get started|start)\b/,
    ]],
  ];

  function match(text) {
    var t = norm(text);
    if (!t) return null;
    for (var i = 0; i < TOPICS.length; i++) {
      var pats = TOPICS[i][1];
      for (var j = 0; j < pats.length; j++) {
        if (pats[j].test(t)) return TOPICS[i][0];
      }
    }
    return null;
  }

  /* ---------------- the sections ----------------
     ctx (all optional, composed truthfully from what the
     caller knows):
       config:         DogEarConfig (numbers come from here)
       unlocked:       bool — the app's one unlocked state
       surface:        'app' | 'browser' (native bar or not)
       modelInstalled: bool
       modelLabel:     the shelf label of the model in use   */

  function cfgOf(ctx) { return (ctx && ctx.config) || {}; }
  function freeMinutes(ctx) {
    var n = cfgOf(ctx).FREE_MINUTES_PER_DAY;
    return typeof n === 'number' ? n : 60;
  }
  function priceLabel(ctx) {
    return cfgOf(ctx).UNLOCK_PRICE_LABEL || 'US$24.99';
  }

  function identity(ctx) {
    return 'I am DogEar. I read your documents aloud — ' +
      'articles, notes, books and files — in your device\u2019s ' +
      'own voice, and I keep your place so you can pick up ' +
      'where you stopped. Your documents live only on this ' +
      'device: there is no DogEar account, and nothing about ' +
      'your reading is tracked or sent anywhere. You can ' +
      'listen with the buttons, or unlock two-way voice and ' +
      'talk to me. Ask me what the buttons do, how Talk ' +
      'works, about the voice models, or what the unlock ' +
      'includes.';
  }

  function controls(ctx) {
    if (ctx && ctx.surface === 'app') {
      return 'The control bar under the reader is built into ' +
        'the app, and every button on it works while I am ' +
        'speaking. Play and Pause start and hold the reading. ' +
        'Stop stops it and keeps your place. Continue picks up ' +
        'from your saved place. Save place pins where you are, ' +
        'so Continue returns there even if you read on. ' +
        'Bookmark, Favorite, Tag and Note each mark the part ' +
        'that is sounding when you press, and your marks are ' +
        'listed under the reader. Talk is how you speak to ' +
        'me — ask me how Talk works, and I will explain it.';
    }
    return 'On this screen, the reader\u2019s own buttons do ' +
      'what the control bar does in the app: play and pause, ' +
      'stop, and your place is kept as you listen. With ' +
      'two-way voice you can also steer by speaking — say ' +
      'pause, resume, go back, start over or stop. In the ' +
      'Android app there is also a control bar with Save ' +
      'place, Bookmark, Favorite, Tag and Note, which mark ' +
      'the part that is sounding when you press.';
  }

  function talk(ctx) {
    var installed = ctx && ctx.modelInstalled;
    return 'Press Talk, and I stop speaking first — the ' +
      'microphone never opens over my own voice. Then say a ' +
      'command, like pause, go back or start over, or ask a ' +
      'question about the document you have open. I work out ' +
      'what you said on this device; your voice is never ' +
      'uploaded. Listening lasts up to twenty seconds — tap ' +
      'Talk again when you are done. About a document, I ' +
      'answer by quoting it: I read you its own words, I do ' +
      'not make answers up, and when the document does not ' +
      'answer, I say so and tell you why.' +
      (installed
        ? ''
        : ' One thing first: Talk needs a speech model from ' +
          'the voice shelf — pick one there and download it ' +
          'once, and then Talk works.');
  }

  function shelf(ctx) {
    return 'Two-way voice needs a speech model, and you ' +
      'choose it. The voice shelf on the reading screen ' +
      'offers five Whisper models — Tiny, Base, Small, ' +
      'Medium and Large — each with its size shown before ' +
      'you download anything, and each under its own ' +
      'licence. Nothing is bundled with the app: the model ' +
      'you pick downloads once, together with the shared ' +
      'runtime, and then listens entirely on this device. ' +
      'Tiny and Base run in the app today, and Base is the ' +
      'recommended starting point. Small, Medium and Large ' +
      'are not offered yet: they need more memory than the ' +
      'in-app engine can safely use, and the phone would ' +
      'shut DogEar down while loading them. They return ' +
      'when the stronger engine lands.';
  }

  function plan(ctx) {
    var free = freeMinutes(ctx);
    var price = priceLabel(ctx);
    if (ctx && ctx.unlocked) {
      return 'You have the DogEar unlock on this device, so ' +
        'listening here is unlimited, the document formats ' +
        'are open, and two-way voice is yours — the free ' +
        'daily minutes no longer apply to you. For anyone ' +
        'on the free plan: every day includes ' + free +
        ' minutes of listening free, and the unlock is one ' +
        'payment of ' + price + ' — never a subscription.';
    }
    return 'Every day includes ' + free + ' minutes of ' +
      'listening free — one hour. Listening is counted by ' +
      'the document, not the clock: hearing a passage again ' +
      'costs nothing, and a document you have started can ' +
      'always be finished. One payment of ' + price +
      ' unlocks DogEar for good: unlimited listening, the ' +
      'PDF, EPUB, Word and HTML formats, and two-way voice ' +
      'with the model shelf included. There is no ' +
      'subscription, and there never will be.';
  }

  function limits(ctx) {
    return 'Honestly, my limits. I have no wake word — I ' +
      'only listen when you press Talk. I do not compose ' +
      'answers: about a document I can only quote it, and ' +
      'about myself I can only tell you what is built in. ' +
      'The three largest voice models are held back until a ' +
      'stronger engine lands, because the phone would shut ' +
      'me down loading them. And my reading voice is your ' +
      'device\u2019s own voice — if this device has no usable ' +
      'voice, I will say so on screen instead of pretending ' +
      'to speak.';
  }

  function help(ctx) {
    return 'Here is what you can ask me. Ask what I am, and ' +
      'I will introduce myself. Ask what the buttons do, how ' +
      'Talk works, about the voice models, or what the ' +
      'unlock includes. While a document is open, you can ' +
      'also ask me about the document — I answer from its ' +
      'own words. Or just say a command: pause, resume, go ' +
      'back, start over, stop.';
  }

  var SECTIONS = {
    identity: identity,
    controls: controls,
    talk: talk,
    shelf: shelf,
    plan: plan,
    limits: limits,
    help: help,
  };

  function answerFor(topic, ctx) {
    var fn = SECTIONS[topic] || identity;
    return fn(ctx || {});
  }

  window.DogEarSelfModel = {
    match: match,
    answerFor: answerFor,
    topics: Object.keys(SECTIONS),
  };
})();
