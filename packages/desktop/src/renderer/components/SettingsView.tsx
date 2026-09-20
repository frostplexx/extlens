/**
 * Settings: where the host is, where the test browsers come from, and what the keychain holds.
 *
 * Three sections because those are the three things the app keeps for the user. The browser
 * section is the only one with a Save button: a path is typed in pieces, and applying a half-typed
 * one would make the launch fail for a reason that looks like the user's fault. Everything else
 * takes effect on the click that says so.
 */
import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Download, FolderOpen, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import type { BridgeHandle } from "../hooks/useBridge";
import type { BrowsersStatus, Settings } from "../types";
import { ConnectForm } from "./Connection";
import { Mono } from "./shared";

export function SettingsView({ bridge, onExit }: { bridge: BridgeHandle; onExit: () => void }) {
    return (
        <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
                <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={onExit}>
                        <ArrowLeft className="size-4" />
                        Back
                    </Button>
                    <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Host</CardTitle>
                        <CardDescription>Where the extension corpus is served from.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4">
                            <ConnectForm
                                initial={bridge.session?.target ?? null}
                                canRemember={bridge.session?.canRemember ?? false}
                                bridge={bridge}
                                onDone={() => toast.success("Connecting…")}
                            />
                        </div>
                    </CardContent>
                </Card>

                <BrowsersSection bridge={bridge} />
                <PasswordsSection bridge={bridge} />
            </div>
        </ScrollArea>
    );
}

const LABELS = {
    mv2: { title: "MV2 browser", hint: "A Chromium build that still loads MV2 extensions (Chrome ≤ 116)." },
    mv3: { title: "MV3 browser", hint: "A current Chromium. Playwright's bundled build is used when nothing else is set." },
} as const;

const SOURCE_TEXT = { configured: "set here", installed: "downloaded by extlens", bundled: "bundled with playwright" } as const;

function BrowsersSection({ bridge }: { bridge: BridgeHandle }) {
    const [status, setStatus] = useState<BrowsersStatus | null>(null);
    const [draft, setDraft] = useState<Settings["browsers"] | null>(null);
    const [saving, setSaving] = useState(false);

    const refresh = useCallback(() => {
        bridge
            .call<BrowsersStatus>("local.browsers.status")
            .then((s) => {
                setStatus(s);
                setDraft((d) => d ?? { dir: s.dir.configured, mv2: s.mv2.configured, mv3: s.mv3.configured });
            })
            .catch((e: Error) => toast.error(e.message));
    }, [bridge]);

    useEffect(refresh, [refresh]);
    // A download finishing changes what resolves, and that is reported through the browser state.
    const phases = `${bridge.local.browsers.mv2.phase}/${bridge.local.browsers.mv3.phase}`;
    useEffect(refresh, [refresh, phases]);

    const dirty =
        status !== null &&
        draft !== null &&
        (draft.dir !== status.dir.configured || draft.mv2 !== status.mv2.configured || draft.mv3 !== status.mv3.configured);

    const save = () => {
        if (!draft) return;
        setSaving(true);
        bridge
            .call<{ settings: Settings }>("local.settings.set", { settings: { browsers: draft } })
            .then(() => {
                toast.success("Browser settings saved");
                refresh();
            })
            .catch((e: Error) => toast.error(e.message))
            .finally(() => setSaving(false));
    };

    const pick = (field: keyof Settings["browsers"]) => {
        const directory = field === "dir";
        bridge
            .call<{ path: string | null }>(directory ? "local.app.pickDirectory" : "local.app.pickFile", {
                title: directory ? "Browser install folder" : `${LABELS[field].title} executable`,
            })
            .then((r) => {
                if (r.path) setDraft((d) => (d ? { ...d, [field]: r.path } : d));
            })
            .catch((e: Error) => toast.error(e.message));
    };

    const install = (label: "mv2" | "mv3") => {
        bridge.call("local.browsers.install", { label }).catch((e: Error) => toast.error(e.message));
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Test browsers</CardTitle>
                <CardDescription>
                    The two Chromium builds a review opens an extension in. Leave a field empty to use the environment or
                    a download.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {status === null || draft === null ? (
                    <Spinner className="size-4 text-muted-foreground" />
                ) : (
                    <FieldGroup>
                        {(["mv2", "mv3"] as const).map((label) => {
                            const browser = bridge.local.browsers[label];
                            const busy = browser.phase === "downloading";
                            const resolved = status[label].resolved;
                            return (
                                <Field key={label}>
                                    <FieldLabel htmlFor={`browser-${label}`}>{LABELS[label].title}</FieldLabel>
                                    <div className="flex gap-2">
                                        <Input
                                            id={`browser-${label}`}
                                            value={draft[label] ?? ""}
                                            onChange={(e) => setDraft({ ...draft, [label]: e.target.value || null })}
                                            placeholder="path to executable"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="font-mono text-xs"
                                        />
                                        <Button type="button" variant="outline" onClick={() => pick(label)}>
                                            <FolderOpen className="size-4" />
                                            Browse
                                        </Button>
                                        <Button type="button" variant="outline" onClick={() => install(label)} disabled={busy}>
                                            {busy ? <Spinner className="size-4" /> : <Download className="size-4" />}
                                            Download
                                        </Button>
                                    </div>
                                    <FieldDescription>
                                        {LABELS[label].hint}
                                        <br />
                                        {busy ? (
                                            <span className="text-peach">{browser.message}</span>
                                        ) : resolved ? (
                                            <>
                                                In use: <Mono className="text-foreground">{resolved.path}</Mono> ({SOURCE_TEXT[resolved.source]})
                                            </>
                                        ) : (
                                            <span className="text-destructive">None found — set a path or download one.</span>
                                        )}
                                        {browser.phase === "failed" && browser.message ? (
                                            <span className="block text-destructive">{browser.message}</span>
                                        ) : null}
                                    </FieldDescription>
                                </Field>
                            );
                        })}

                        <Field>
                            <FieldLabel htmlFor="browser-dir">Install folder</FieldLabel>
                            <div className="flex gap-2">
                                <Input
                                    id="browser-dir"
                                    value={draft.dir ?? ""}
                                    onChange={(e) => setDraft({ ...draft, dir: e.target.value || null })}
                                    placeholder={status.dir.effective}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="font-mono text-xs"
                                />
                                <Button type="button" variant="outline" onClick={() => pick("dir")}>
                                    <FolderOpen className="size-4" />
                                    Browse
                                </Button>
                            </div>
                            <FieldDescription>
                                Where downloaded Chrome for Testing builds go. Currently{" "}
                                <Mono className="text-foreground">{status.dir.effective}</Mono>.
                            </FieldDescription>
                        </Field>

                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={!dirty || saving}
                                onClick={() => setDraft({ dir: status.dir.configured, mv2: status.mv2.configured, mv3: status.mv3.configured })}
                            >
                                Revert
                            </Button>
                            <Button type="button" disabled={!dirty || saving} onClick={save}>
                                Save
                            </Button>
                        </div>
                    </FieldGroup>
                )}
            </CardContent>
        </Card>
    );
}

function PasswordsSection({ bridge }: { bridge: BridgeHandle }) {
    const canRemember = bridge.session?.canRemember ?? false;
    const [destinations, setDestinations] = useState<string[] | null>(null);

    const refresh = useCallback(() => {
        bridge
            .call<{ destinations: string[] }>("local.session.saved")
            .then((r) => setDestinations(r.destinations))
            .catch((e: Error) => toast.error(e.message));
    }, [bridge]);
    useEffect(refresh, [refresh]);

    const forget = (destination: string) => {
        bridge
            .call("local.session.forget", { destination })
            .then(() => {
                toast.success(`Forgot the password for ${destination}`);
                refresh();
            })
            .catch((e: Error) => toast.error(e.message));
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Saved passwords</CardTitle>
                <CardDescription>
                    {canRemember
                        ? "ssh passwords kept in the OS keychain, encrypted so only this app on this account can read them."
                        : "No keychain is available on this system, so passwords are never stored."}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {destinations === null ? (
                    <Spinner className="size-4 text-muted-foreground" />
                ) : destinations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None.</p>
                ) : (
                    <ul className="divide-y rounded-lg border">
                        {destinations.map((d) => (
                            <li key={d} className="flex items-center justify-between gap-3 px-3 py-2">
                                <span className="flex items-center gap-2 text-sm">
                                    <KeyRound className="size-3.5 text-muted-foreground" />
                                    <Mono>{d}</Mono>
                                </span>
                                <Button size="xs" variant="ghost" onClick={() => forget(d)}>
                                    <Trash2 className="size-3" />
                                    Forget
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
