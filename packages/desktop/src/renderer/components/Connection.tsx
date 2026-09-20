/**
 * Where the host is, and the password to reach it.
 *
 * Two pieces. `ConnectForm` is the connection form — a local WebSocket URL, or an ssh destination
 * with the port the host listens on there — and lives on the settings page, the one place the
 * host is chosen. `SecretPromptDialog` is raised by the main process, not the user: the tunnel
 * found no key that works and is waiting, so it is modal and cannot be dismissed except by
 * answering or cancelling.
 *
 * The password is never held here longer than the submit: it goes to the main process, which
 * hands it to ssh through askpass and, only if the tunnel comes up and the box was ticked, to the
 * OS keychain. "Remember" is offered only when a keychain exists; a checkbox that silently did
 * nothing would be worse than none.
 */
import * as React from "react";
import { useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BridgeHandle } from "../hooks/useBridge";
import type { HostTarget, SessionState } from "../types";

const DEFAULT_WS_URL = "ws://localhost:8081";
const DEFAULT_REMOTE_PORT = 8081;

export function SecretPromptDialog({ session, bridge }: { session: SessionState | null; bridge: BridgeHandle }) {
    const prompt = session?.prompt ?? null;
    return (
        <Dialog open={prompt !== null}>
            <DialogContent showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()}>
                {prompt ? (
                    <PasswordPrompt
                        key={prompt.id}
                        id={prompt.id}
                        destination={prompt.destination}
                        retry={prompt.retry}
                        canRemember={session?.canRemember ?? false}
                        bridge={bridge}
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

/** The connection form: the settings page's host section. */
export function ConnectForm({
    initial,
    canRemember,
    bridge,
    onDone,
}: {
    initial: HostTarget | null;
    canRemember: boolean;
    bridge: BridgeHandle;
    onDone: () => void;
}) {
    const [kind, setKind] = useState<"ws" | "ssh">(initial?.kind ?? "ws");
    const [url, setUrl] = useState(initial?.kind === "ws" ? initial.url : DEFAULT_WS_URL);
    const [destination, setDestination] = useState(initial?.kind === "ssh" ? initial.destination : "");
    const [remotePort, setRemotePort] = useState(String(initial?.kind === "ssh" ? initial.remotePort : DEFAULT_REMOTE_PORT));
    const [secret, setSecret] = useState("");
    const [remember, setRemember] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Whether the keychain already has this host, so the form can say so instead of asking again.
    useEffect(() => {
        if (!canRemember || kind !== "ssh" || destination.trim() === "") {
            setSaved(false);
            return;
        }
        let cancelled = false;
        bridge
            .call<{ saved: boolean }>("local.session.hasSecret", { destination: destination.trim() })
            .then((r) => {
                if (!cancelled) setSaved(r.saved);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [bridge, canRemember, kind, destination]);

    const forget = () => {
        bridge
            .call("local.session.forget", { destination: destination.trim() })
            .then(() => setSaved(false))
            .catch((e: Error) => setError(e.message));
    };

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const target: HostTarget =
            kind === "ws"
                ? { kind, url: url.trim() }
                : { kind, destination: destination.trim(), remotePort: Number(remotePort) };
        bridge
            .call("local.session.connect", { target, secret: kind === "ssh" ? secret : undefined, remember })
            .then(() => {
                setSecret("");
                onDone();
            })
            .catch((err: Error) => setError(err.message))
            .finally(() => setBusy(false));
    };

    return (
        <form onSubmit={submit} className="contents">
            <Tabs value={kind} onValueChange={(v) => setKind(v as "ws" | "ssh")}>
                <TabsList className="w-full">
                    <TabsTrigger value="ws" className="flex-1">
                        Local
                    </TabsTrigger>
                    <TabsTrigger value="ssh" className="flex-1">
                        SSH
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            <FieldGroup>
                {kind === "ws" ? (
                    <Field>
                        <FieldLabel htmlFor="connect-url">WebSocket URL</FieldLabel>
                        <Input
                            id="connect-url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder={DEFAULT_WS_URL}
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <FieldDescription>Where the host serves the extlens protocol.</FieldDescription>
                    </Field>
                ) : (
                    <>
                        <div className="grid grid-cols-[1fr_6rem] gap-3">
                            <Field>
                                <FieldLabel htmlFor="connect-destination">Destination</FieldLabel>
                                <Input
                                    id="connect-destination"
                                    value={destination}
                                    onChange={(e) => setDestination(e.target.value)}
                                    placeholder="user@host"
                                    autoFocus
                                    autoComplete="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="connect-port">Remote port</FieldLabel>
                                <Input
                                    id="connect-port"
                                    value={remotePort}
                                    onChange={(e) => setRemotePort(e.target.value)}
                                    inputMode="numeric"
                                    placeholder={String(DEFAULT_REMOTE_PORT)}
                                />
                            </Field>
                        </div>
                        <Field>
                            <FieldLabel htmlFor="connect-secret">Password</FieldLabel>
                            <Input
                                id="connect-secret"
                                type="password"
                                value={secret}
                                onChange={(e) => setSecret(e.target.value)}
                                placeholder={saved ? "saved in keychain" : "optional"}
                                autoComplete="off"
                            />
                            <FieldDescription>
                                Keys and the agent are tried first; a password is only used if they fail.
                            </FieldDescription>
                        </Field>
                        {saved ? (
                            <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-2">
                                    <KeyRound className="size-3.5" />A password for this host is in the keychain
                                </span>
                                <Button type="button" size="xs" variant="ghost" onClick={forget}>
                                    <Trash2 className="size-3" />
                                    Forget
                                </Button>
                            </div>
                        ) : canRemember ? (
                            <Field orientation="horizontal">
                                <Checkbox
                                    id="connect-remember"
                                    checked={remember}
                                    onCheckedChange={(v) => setRemember(v === true)}
                                    disabled={secret === ""}
                                />
                                <FieldLabel htmlFor="connect-remember" className="font-normal">
                                    Remember this password in the keychain
                                </FieldLabel>
                            </Field>
                        ) : null}
                    </>
                )}
                {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>

            <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                    Connect
                </Button>
            </div>
        </form>
    );
}

function PasswordPrompt({
    id,
    destination,
    retry,
    canRemember,
    bridge,
}: {
    id: number;
    destination: string;
    retry: boolean;
    canRemember: boolean;
    bridge: BridgeHandle;
}) {
    const [secret, setSecret] = useState("");
    const [remember, setRemember] = useState(false);
    const [busy, setBusy] = useState(false);

    const answer = (value: string) => {
        setBusy(true);
        // The main process closes the prompt by publishing a state without it; nothing to do here
        // on success, and on failure the prompt is still open for another try.
        bridge.call("local.session.secret", { id, secret: value, remember: value !== "" && remember }).finally(() => setBusy(false));
    };

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                answer(secret);
            }}
            className="contents"
        >
            <DialogHeader>
                <DialogTitle>Password for {destination}</DialogTitle>
                <DialogDescription>
                    {retry ? "That password was rejected. Try again, or cancel." : "No key was accepted; ssh is asking for a password."}
                </DialogDescription>
            </DialogHeader>

            <FieldGroup>
                <Field data-invalid={retry || undefined}>
                    <FieldLabel htmlFor="prompt-secret">Password</FieldLabel>
                    <Input
                        id="prompt-secret"
                        type="password"
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        autoFocus
                        autoComplete="off"
                        aria-invalid={retry || undefined}
                    />
                </Field>
                {canRemember ? (
                    <Field orientation="horizontal">
                        <Checkbox
                            id="prompt-remember"
                            checked={remember}
                            onCheckedChange={(v) => setRemember(v === true)}
                        />
                        <FieldLabel htmlFor="prompt-remember" className="font-normal">
                            Remember this password in the keychain
                        </FieldLabel>
                    </Field>
                ) : null}
            </FieldGroup>

            <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => answer("")}>
                    Cancel
                </Button>
                <Button type="submit" disabled={busy || secret === ""}>
                    Connect
                </Button>
            </DialogFooter>
        </form>
    );
}
