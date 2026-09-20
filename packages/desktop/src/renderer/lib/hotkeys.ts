/**
 * Single-key shortcuts, shared between the app-level handler and the review form.
 *
 * Every key on the review page is on the LEFT half of the keyboard: a pass is run with the right
 * hand on the mouse, driving two browser windows, and a shortcut that needs that hand to come back
 * is not much faster than clicking. That rules out j/k, [/], Enter and the arrows.
 */
import { useEffect } from "react";

/** Whether a keystroke is going into a text field, where letters mean letters. */
export function isTyping(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.getAttribute("role") === "combobox" ||
        target?.isContentEditable === true
    );
}

/** A plain keypress: no modifier, not typing. Cmd/Ctrl combinations belong to the platform. */
export function isPlainKey(e: KeyboardEvent): boolean {
    return !isTyping(e) && !e.metaKey && !e.ctrlKey && !e.altKey;
}

/**
 * Bind plain keys to actions while `enabled`. The map is read on each keystroke, so callers can
 * pass a fresh object literal without worrying about identity.
 */
export function useHotkeys(enabled: boolean, keys: Record<string, (() => void) | undefined>): void {
    useEffect(() => {
        if (!enabled) return;
        const onKey = (e: KeyboardEvent) => {
            if (!isPlainKey(e)) return;
            const action = keys[e.key];
            if (!action) return;
            e.preventDefault();
            action();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });
}
