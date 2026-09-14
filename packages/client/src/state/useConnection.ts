/**
 * Connection lifecycle: the JSON-RPC client, and in ssh mode the tunnel it rides on.
 *
 * Local mode is simple — construct a client against the given url. SSH mode is not: the client
 * cannot exist until the tunnel is up, because its port is assigned by the tunnel, and the tunnel
 * may need a password typed into the UI before it connects. That ordering (prompt → tunnel →
 * client → first fetch) is the reason this is a hook rather than a constructor call, and keeping
 * it in one file is what lets every other hook simply take `client` and `status` as inputs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ExtlensClient } from "../api.js";
import { createSshManager } from "../ssh.js";
import type { SshManager, SshSpec, TunnelStatus } from "../ssh.js";
import type { ConnectionStatus } from "../types.js";

export interface PasswordPrompt {
    message: string;
    resolve: (secret: string) => void;
}

export interface Connection {
    client: ExtlensClient | null;
    status: ConnectionStatus;
    /** Transport-level detail worth showing in the status bar, or null. */
    message: string | null;
    /** Null in local mode; the tunnel state in ssh mode. */
    tunnel: TunnelStatus | null;
    sshMode: boolean;
    /** The live ssh session, for resolving remote file refs. Null in local mode. */
    manager: SshManager | null;
    /** Non-null while the tunnel is waiting on a password; the UI must render a prompt. */
    passwordPrompt: PasswordPrompt | null;
    /** Hand the typed secret to the waiting tunnel, or "" to cancel it, and dismiss the prompt. */
    answerPrompt: (secret: string) => void;
}

export function useConnection(wsUrl: string, sshSpec: SshSpec | null): Connection {
    const sshMode = sshSpec !== null;
    const [status, setStatus] = useState<ConnectionStatus>("connecting");
    const [message, setMessage] = useState<string | null>(null);
    const [tunnel, setTunnel] = useState<TunnelStatus>(sshMode ? "connecting" : "up");
    const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(null);
    const managerRef = useRef<SshManager | null>(null);

    const handleStatus = useCallback(
        (next: ConnectionStatus, detail?: string) => {
            setStatus(next);
            setMessage(detail ?? null);
            // A dropped connection may mean the tunnel died underneath us. Probe now rather than
            // waiting for the next health check, so the UI blames the right layer.
            if (sshMode && next === "disconnected") managerRef.current?.checkNow();
        },
        [sshMode],
    );

    const requestSecret = useCallback(
        (): Promise<string> =>
            new Promise((resolve) => {
                setPasswordPrompt({ message: `password for ${sshSpec?.destination}:`, resolve });
            }),
        [sshSpec],
    );

    if (sshMode && !managerRef.current) {
        managerRef.current = createSshManager({
            spec: sshSpec as SshSpec,
            getSecret: requestSecret,
            onStatus: (next, detail) => {
                setTunnel(next);
                if (next === "failed" && detail) setMessage(detail);
            },
        });
    }

    const [client, setClient] = useState<ExtlensClient | null>(() =>
        sshMode ? null : new ExtlensClient(wsUrl, handleStatus),
    );

    useEffect(() => {
        if (!client) return;
        client.start();
        return () => client.stop();
    }, [client]);

    useEffect(() => {
        if (!sshMode) return;
        managerRef.current?.start();
        const onExit = () => managerRef.current?.stop();
        process.on("exit", onExit);
        return () => {
            process.off("exit", onExit);
            managerRef.current?.stop();
        };
    }, [sshMode]);

    // SSH mode: build the client once the tunnel is up, against the tunnel's fixed local port so
    // it reconnects on its own across tunnel restarts.
    useEffect(() => {
        if (!sshMode || tunnel !== "up" || client) return;
        const port = managerRef.current?.localPort;
        if (port) setClient(new ExtlensClient(`ws://127.0.0.1:${port}`, handleStatus));
    }, [sshMode, tunnel, client, handleStatus]);

    const answerPrompt = useCallback((secret: string) => {
        setPasswordPrompt((prompt) => {
            prompt?.resolve(secret);
            return null;
        });
    }, []);

    return {
        client,
        status,
        message,
        tunnel: sshMode ? tunnel : null,
        sshMode,
        manager: managerRef.current,
        passwordPrompt,
        answerPrompt,
    };
}
