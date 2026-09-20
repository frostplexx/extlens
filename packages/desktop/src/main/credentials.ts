/**
 * Remembered ssh passwords, encrypted with the OS keychain.
 *
 * Electron's safeStorage encrypts with a key the operating system holds — the login Keychain on
 * macOS, DPAPI on Windows, the secret service on Linux — so the file on disk is ciphertext that
 * only this app, on this account, on this machine can read. The file itself is a map from ssh
 * destination to base64 ciphertext; nothing in it is usable without the key.
 *
 * When no keychain is available (some Linux sessions), nothing is stored and the UI is told so.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import type { CredentialStore } from "./core.js";

type Vault = Record<string, string>;

async function readVault(file: string): Promise<Vault> {
    try {
        const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Vault;
    } catch {
        /* missing or unreadable: an empty vault */
    }
    return {};
}

async function writeVault(file: string, vault: Vault): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(vault, null, 2), { mode: 0o600 });
}

/** A store at `file`, or null when this machine cannot encrypt. Call after `app` is ready. */
export function createCredentialStore(file: string): CredentialStore | null {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return {
        async load(destination) {
            const vault = await readVault(file);
            const encoded = vault[destination];
            if (!encoded) return null;
            try {
                return safeStorage.decryptString(Buffer.from(encoded, "base64"));
            } catch {
                // Encrypted under a key we no longer have (a different account, a reinstall).
                // Not an error the user can act on beyond typing the password again.
                return null;
            }
        },
        async save(destination, secret) {
            const vault = await readVault(file);
            vault[destination] = safeStorage.encryptString(secret).toString("base64");
            await writeVault(file, vault);
        },
        async list() {
            return Object.keys(await readVault(file)).sort();
        },
        async forget(destination) {
            const vault = await readVault(file);
            if (!(destination in vault)) return;
            delete vault[destination];
            await writeVault(file, vault);
        },
    };
}
