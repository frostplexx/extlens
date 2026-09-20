/**
 * What the user configured, as opposed to what the environment or a host provides.
 *
 * Small on purpose: the connection target has its own file (it changes per session), and
 * passwords live in the keychain. What is left is where the test browsers come from. A null means
 * "not set" — the environment variable, or the default, applies — so clearing a field in the
 * settings page restores whatever the terminal user would have had.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface Settings {
    browsers: {
        /** Install dir for downloaded Chrome for Testing builds. */
        dir: string | null;
        /** Executable for the MV2-capable browser. */
        mv2: string | null;
        /** Executable for the current browser. */
        mv3: string | null;
    };
}

export const EMPTY_SETTINGS: Settings = { browsers: { dir: null, mv2: null, mv3: null } };

export interface SettingsStore {
    load(): Promise<Settings>;
    save(settings: Settings): Promise<void>;
}

/** Settings from untrusted UI input: unknown keys dropped, blanks read as "not set". */
export function parseSettings(raw: unknown): Settings {
    const r = (raw ?? {}) as { browsers?: Record<string, unknown> };
    const b = r.browsers ?? {};
    const field = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
    return { browsers: { dir: field(b.dir), mv2: field(b.mv2), mv3: field(b.mv3) } };
}

export function createSettingsStore(file: string): SettingsStore {
    return {
        async load() {
            try {
                return parseSettings(JSON.parse(await readFile(file, "utf8")));
            } catch {
                return EMPTY_SETTINGS;
            }
        },
        async save(settings) {
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, JSON.stringify(settings, null, 2));
        },
    };
}
