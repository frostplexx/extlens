/**
 * The keymap is the client's single source of truth for input, so these tests guard the two
 * properties that made three-places-to-edit a bug factory: every advertised key resolves to an
 * action, and every action is advertised somewhere the user can find it.
 */
import { describe, expect, it } from "vitest";
import type { Key } from "ink";
import { KEYMAP, helpGroups, hintsFor, matchesChord, resolve, type Scope } from "../src/keys/keymap.js";

const NO_MODS: Key = {
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
  pageDown: false, pageUp: false, return: false, escape: false, ctrl: false,
  shift: false, tab: false, backspace: false, delete: false, meta: false,
} as Key;

const key = (over: Partial<Key> = {}): Key => ({ ...NO_MODS, ...over });

describe("chord matching", () => {
  it("matches bare characters, named keys and ctrl chords", () => {
    expect(matchesChord("j", "j", key())).toBe(true);
    expect(matchesChord("up", "", key({ upArrow: true }))).toBe(true);
    expect(matchesChord("enter", "", key({ return: true }))).toBe(true);
    expect(matchesChord("ctrl+u", "u", key({ ctrl: true }))).toBe(true);
  });

  it("does not let a modified keypress fire a bare chord", () => {
    // The bug this prevents: ctrl+c quitting via the 'c' binding rather than the exit path.
    expect(matchesChord("u", "u", key({ ctrl: true }))).toBe(false);
    expect(matchesChord("q", "q", key({ meta: true }))).toBe(false);
  });

  it("treats backspace and delete as one chord, as ink reports both", () => {
    expect(matchesChord("backspace", "", key({ backspace: true }))).toBe(true);
    expect(matchesChord("backspace", "", key({ delete: true }))).toBe(true);
  });
});

describe("scope resolution", () => {
  it("routes the same chord to different actions per scope", () => {
    expect(resolve(KEYMAP, "explorer", "", key({ return: true }))).toBe("open");
    expect(resolve(KEYMAP, "analyzer", "b", key())).toBe("launchBrowsers");
    // 'b' is not bound in the explorer, and must not leak in from another scope.
    expect(resolve(KEYMAP, "explorer", "b", key())).toBe(null);
  });

  it("makes global bindings available in every scope", () => {
    for (const scope of ["explorer", "analyzer", "log"] as Scope[]) {
      expect(resolve(KEYMAP, scope, "q", key())).toBe("quit");
      expect(resolve(KEYMAP, scope, "?", key())).toBe("help");
    }
  });

  it("lets a scoped binding shadow a global chord", () => {
    // The analyzer's scroll keys must win over anything global bound to the same chord.
    expect(resolve(KEYMAP, "analyzer", "k", key())).toBe("up");
  });
});

describe("derived views of the keymap", () => {
  it("advertises only keys that actually resolve", () => {
    for (const binding of KEYMAP) {
      const scope: Scope = binding.scope === "global" ? "explorer" : binding.scope;
      for (const chord of binding.keys) {
        const named = /^(up|down|left|right|enter|esc|tab|backspace|pgup|pgdn)$/.test(chord);
        const press = named
          ? key({
              up: { upArrow: true }, down: { downArrow: true }, left: { leftArrow: true },
              right: { rightArrow: true }, enter: { return: true }, esc: { escape: true },
              tab: { tab: true }, backspace: { backspace: true }, pgup: { pageUp: true },
              pgdn: { pageDown: true },
            }[chord as string])
          : key();
        const input = named ? "" : chord;
        expect(resolve(KEYMAP, scope, input, press)).not.toBe(null);
      }
    }
  });

  it("gives every binding a help row", () => {
    const rows = helpGroups().flatMap((g) => g.rows);
    expect(rows.length).toBe(KEYMAP.length);
    expect(rows.every((r) => r.label.length > 0)).toBe(true);
  });

  it("builds footer hints per scope", () => {
    expect(hintsFor("explorer")).toContain("enter open");
    expect(hintsFor("explorer")).toContain("q quit");
    expect(hintsFor("analyzer")).toContain("b browsers");
    // Aliases stay out of the footer: one line, so `k` next to `up` is noise.
    expect(hintsFor("explorer")).not.toContain("select next");
  });
});
