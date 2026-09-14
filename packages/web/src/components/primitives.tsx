/** Small shared pieces. Presentational only: no bridge calls, no data fetching. */
import React from "react";

/** Colour ramp for an interestingness score, matching the terminal client's thresholds. */
export function scoreTone(score: number): string {
    if (score >= 70) return "text-green";
    if (score >= 40) return "text-yellow";
    return "text-red";
}

export function ScoreBar({ score }: { score: number }) {
    return (
        <div className="flex items-center gap-2">
            <span className={`w-8 text-right font-semibold tabular-nums ${scoreTone(score)}`}>{score}</span>
            <div className="h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-surface0">
                <div
                    className={`h-full rounded-full ${score >= 70 ? "bg-green" : score >= 40 ? "bg-yellow" : "bg-red"}`}
                    style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                />
            </div>
        </div>
    );
}

export function Pill({
    children,
    tone = "neutral",
    title,
}: {
    children: React.ReactNode;
    tone?: "neutral" | "good" | "warn" | "bad" | "info";
    title?: string;
}) {
    const tones = {
        neutral: "bg-surface0 text-subtext0 ring-surface1",
        good: "bg-green/10 text-green ring-green/30",
        warn: "bg-peach/10 text-peach ring-peach/30",
        bad: "bg-red/10 text-red ring-red/30",
        info: "bg-blue/10 text-blue ring-blue/30",
    } as const;
    return (
        <span
            title={title}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-none ring-1 ring-inset ${tones[tone]}`}
        >
            {children}
        </span>
    );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
    return (
        <section className="border-t border-surface0 px-4 py-3">
            <header className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-mauve">{title}</h3>
                {right}
            </header>
            {children}
        </section>
    );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex gap-3 py-0.5">
            <dt className="w-36 shrink-0 text-subtext0">{label}</dt>
            <dd className="min-w-0 break-words text-text">{children}</dd>
        </div>
    );
}

export function Button({
    children,
    onClick,
    tone = "default",
    disabled,
    title,
}: {
    children: React.ReactNode;
    onClick?: () => void;
    tone?: "default" | "primary" | "danger";
    disabled?: boolean;
    title?: string;
}) {
    const tones = {
        default: "bg-surface0 hover:bg-surface1 text-text ring-surface1",
        primary: "bg-mauve/15 hover:bg-mauve/25 text-mauve ring-mauve/40",
        danger: "bg-red/10 hover:bg-red/20 text-red ring-red/30",
    } as const;
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onClick={onClick}
            className={`rounded px-2.5 py-1 text-xs ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
        >
            {children}
        </button>
    );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
    return <div className="px-4 py-10 text-center text-subtext0">{children}</div>;
}

export function ErrorNote({ message }: { message: string }) {
    return (
        <div className="mx-4 my-3 rounded border border-red/30 bg-red/10 px-3 py-2 text-red">
            {/* Protocol errors can be long; wrap rather than clip, since this is the only place
                the cause appears. */}
            <span className="break-words">{message}</span>
        </div>
    );
}
