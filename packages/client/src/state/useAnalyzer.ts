/**
 * The analyzer's subject: one extension's profile, file refs and saved report.
 *
 * The three RPCs are issued together and adopted together, guarded by an id check, because the
 * user can page through extensions faster than a remote host answers — without the guard a slow
 * response for extension A lands on top of extension B's screen.
 *
 * `advance` exists for the review loop: submitting a report should move to the next extension,
 * including across a page boundary, so a reviewer never has to return to the list between two
 * verifications.
 */
import { useCallback, useState } from "react";
import type { ExtensionLight, ExtensionProfile, FileRefs, Report } from "@extlens/protocol";
import type { ExtlensClient } from "@extlens/session";
import type { SshManager } from "@extlens/session";
import type { ExtensionList } from "./useExtensionList.js";

export interface AnalyzerSubject {
    id: string | null;
    profile: ExtensionProfile | null;
    files: FileRefs | null;
    report: Report | null;
    loading: boolean;
    error: string | null;
    /** First visible line when the profile is taller than the terminal. */
    scroll: number;
}

const EMPTY: AnalyzerSubject = {
    id: null,
    profile: null,
    files: null,
    report: null,
    loading: false,
    error: null,
    scroll: 0,
};

export interface Analyzer {
    subject: AnalyzerSubject;
    show: (light: ExtensionLight) => void;
    reload: () => void;
    scrollBy: (delta: number) => void;
    scrollTo: (to: "top" | "bottom") => void;
    /** Move to the next extension, rolling onto the next page. False at the end of the corpus. */
    advance: () => Promise<boolean>;
}

export function useAnalyzer(
    client: ExtlensClient | null,
    list: ExtensionList,
    ssh: { sshMode: boolean; manager: SshManager | null },
    onShow?: () => void,
): Analyzer {
    const [subject, setSubject] = useState<AnalyzerSubject>(EMPTY);

    const load = useCallback(
        async (id: string) => {
            if (!client) return;
            try {
                const [get, files, report] = await Promise.all([
                    client.call<{ extension: ExtensionProfile }>("extensions.get", { id }),
                    client.call<{ files: FileRefs }>("extensions.files", { id }),
                    client.call<{ report: Report | null }>("reports.get", { extensionId: id }),
                ]);
                let fileRefs = files.files;
                // Remote host: the browsers run here, so the files have to come here too.
                if (ssh.sshMode) {
                    const session = ssh.manager?.session;
                    if (!session) throw new Error("tunnel not up");
                    const resolved: FileRefs = {};
                    for (const label of ["mv2", "mv3"] as const) {
                        const ref = files.files[label];
                        if (ref) resolved[label] = await session.downloadRef(label, id, ref);
                    }
                    fileRefs = resolved;
                }
                setSubject((s) =>
                    s.id === id
                        ? { ...s, profile: get.extension, files: fileRefs, report: report.report, loading: false }
                        : s,
                );
            } catch (error) {
                setSubject((s) => (s.id === id ? { ...s, loading: false, error: (error as Error).message } : s));
            }
        },
        [client, ssh.sshMode, ssh.manager],
    );

    const show = useCallback(
        (light: ExtensionLight) => {
            list.select(light.id);
            setSubject({ ...EMPTY, id: light.id, loading: true });
            onShow?.();
            void load(light.id);
        },
        [list, load, onShow],
    );

    const reload = useCallback(() => {
        if (subject.id) void load(subject.id);
    }, [subject.id, load]);

    const scrollBy = useCallback((delta: number) => {
        setSubject((s) => ({ ...s, scroll: Math.max(0, s.scroll + delta) }));
    }, []);

    const scrollTo = useCallback((to: "top" | "bottom") => {
        // The view clamps the bottom against its own content height; a large number is the
        // cheapest way to say "as far as this content goes".
        setSubject((s) => ({ ...s, scroll: to === "top" ? 0 : Number.MAX_SAFE_INTEGER }));
    }, []);

    const advance = useCallback(async (): Promise<boolean> => {
        const id = subject.id;
        if (!id) return false;
        const { lights, page, totalPages } = list.state;
        const next = lights[lights.findIndex((l) => l.id === id) + 1];
        if (next) {
            show(next);
            return true;
        }
        if (page >= totalPages) return false;
        try {
            const result = await list.loadPage(page + 1);
            const first = result?.extensions[0];
            if (!result || !first) return false;
            list.adoptPage(page + 1, result);
            show(first);
            return true;
        } catch {
            return false;
        }
    }, [subject.id, list, show]);

    return { subject, show, reload, scrollBy, scrollTo, advance };
}
