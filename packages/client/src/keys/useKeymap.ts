/**
 * Keyboard dispatch.
 *
 * The old chain was one 180-line `useInput` whose control flow encoded the precedence rules as a
 * sequence of early returns: password prompt before help before form before download prompt
 * before search before view bindings. Adding a modal meant finding the right spot in that chain,
 * and nothing named the concept it turned on.
 *
 * That concept is capture: a modal that owns the keyboard until it is dismissed. Here modals are
 * a list, checked in order, each returning true once it has consumed the keypress; only if none
 * does is the keymap consulted for the active scope. Precedence is the array order, which is
 * visible in one place rather than implied by the shape of a function.
 */
import { useInput, type Key } from "ink";
import { KEYMAP, resolve, type ActionId, type Scope } from "./keymap.js";

/** A modal keyboard owner. Return true to consume the keypress. */
export type Capture = (input: string, key: Key) => boolean;

export type Handlers = Partial<Record<ActionId, () => void>>;

export function useKeymap(options: {
    scope: Scope;
    handlers: Handlers;
    /** Modals in precedence order; the first to return true wins. */
    captures?: Capture[];
    /** Always available, checked before everything: the one key that must never be trapped. */
    onExit: () => void;
}): void {
    const { scope, handlers, captures = [], onExit } = options;
    useInput((input, key) => {
        // ctrl+c is not a binding. A modal that swallowed it would make the client unkillable
        // from inside, which is exactly the bug a capture list makes easy to write.
        if (key.ctrl && input === "c") {
            onExit();
            return;
        }
        for (const capture of captures) {
            if (capture(input, key)) return;
        }
        const action = resolve(KEYMAP, scope, input, key);
        if (action) handlers[action]?.();
    });
}
