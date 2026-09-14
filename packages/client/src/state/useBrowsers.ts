/**
 * The MV2/MV3 test browsers.
 *
 * This is the one part of the client that must run locally even when the host is remote: manual
 * verification means watching two Chrome for Testing builds side by side on the reviewer's own
 * screen. In ssh mode the extension files are downloaded through the tunnel first (see
 * useAnalyzer), and only the resulting local paths reach this hook.
 *
 * A missing browser is a question, not an error: the binary is a ~150MB download, so a missing
 * one is queued as a prompt for the UI to confirm rather than fetched behind the user's back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileRefs } from "@extlens/protocol";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installChrome, missingBrowserMessage } from "@extlens/session";
import { BrowserManager, resolveExecutable } from "@extlens/session";
import type { BrowserState } from "../types.js";

export type BrowserLabel = "mv2" | "mv3";

export const IDLE_BROWSER: BrowserState = { phase: "idle", message: null, extensionId: null };

export interface DownloadPrompt {
    label: BrowserLabel;
    message: string;
}

export interface Browsers {
    mv2: BrowserState;
    mv3: BrowserState;
    /** Missing browsers awaiting a download decision, FIFO; the UI prompts for prompts[0]. */
    prompts: DownloadPrompt[];
    /** Launch every browser the extension has files for. */
    launch: (files: FileRefs | null) => Promise<void>;
    closeAll: () => Promise<void>;
    /** Answer the head prompt: download and launch, or decline. */
    answerPrompt: (accept: boolean, files: FileRefs | null) => void;
}

/** A protocol file ref as a local extension directory. */
export function refToPath(ref: string): string {
    const path = ref.startsWith("file://") ? fileURLToPath(ref) : ref;
    return path.endsWith("manifest.json") ? dirname(path) : path;
}

export function useBrowsers(): Browsers {
    const managerRef = useRef(new BrowserManager());
    const [mv2, setMv2] = useState<BrowserState>(IDLE_BROWSER);
    const [mv3, setMv3] = useState<BrowserState>(IDLE_BROWSER);
    const [prompts, setPrompts] = useState<DownloadPrompt[]>([]);

    const setFor = useCallback((label: BrowserLabel, next: BrowserState) => {
        (label === "mv2" ? setMv2 : setMv3)(next);
    }, []);

    // Chrome processes outlive the React tree unless they are killed on unmount.
    useEffect(() => {
        const manager = managerRef.current;
        return () => void manager.closeAll();
    }, []);

    const launchOne = useCallback(
        (label: BrowserLabel, executable: string, extensionPath: string) => {
            void managerRef.current.launch({ label, executable, extensionPath }, IDLE_BROWSER, (next) =>
                setFor(label, next),
            );
        },
        [setFor],
    );

    const launch = useCallback(
        async (files: FileRefs | null) => {
            if (!files) return;
            await managerRef.current.closeAll();
            setMv2(IDLE_BROWSER);
            setMv3(IDLE_BROWSER);
            setPrompts([]);
            const missing: DownloadPrompt[] = [];
            for (const label of ["mv2", "mv3"] as const) {
                const ref = files[label];
                if (!ref) continue;
                const executable = resolveExecutable(label);
                if (!executable) {
                    missing.push({ label, message: missingBrowserMessage(label) });
                    continue;
                }
                launchOne(label, executable, refToPath(ref));
            }
            if (missing.length > 0) setPrompts(missing);
        },
        [launchOne],
    );

    const closeAll = useCallback(async () => {
        await managerRef.current.closeAll();
        const closed: BrowserState = { phase: "closed", message: "closed", extensionId: null };
        setMv2(closed);
        setMv3(closed);
    }, []);

    const answerPrompt = useCallback(
        (accept: boolean, files: FileRefs | null) => {
            const prompt = prompts[0];
            if (!prompt) return;
            setPrompts((p) => p.slice(1));
            const ref = files?.[prompt.label];
            if (!accept || !ref) {
                setFor(prompt.label, { phase: "failed", message: prompt.message, extensionId: null });
                return;
            }
            setFor(prompt.label, {
                phase: "downloading",
                message: "downloading chrome for testing…",
                extensionId: null,
            });
            void installChrome(prompt.label, (pct) =>
                setFor(prompt.label, {
                    phase: "downloading",
                    message: `downloading chrome for testing… ${pct}%`,
                    extensionId: null,
                }),
            )
                .then((executable) => launchOne(prompt.label, executable, refToPath(ref)))
                .catch((error: unknown) =>
                    setFor(prompt.label, {
                        phase: "failed",
                        message: error instanceof Error ? error.message : String(error),
                        extensionId: null,
                    }),
                );
        },
        [prompts, launchOne, setFor],
    );

    return { mv2, mv3, prompts, launch, closeAll, answerPrompt };
}
