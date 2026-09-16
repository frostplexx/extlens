/**
 * "Why did this fail?" — a model's reading of the report against the code, on demand.
 *
 * On demand, not automatic: it costs a model call and takes a while, and most rows are never asked.
 * The answer is a starting point for the reviewer, which is why the card offers to fold it into
 * the notes rather than storing it anywhere on its own — a report is the reviewer's record, and
 * the model's paragraph only becomes part of it when they say so.
 */
import * as React from "react";
import { useEffect, useState } from "react";
import type { ExplainResult } from "@extlens/protocol";
import { Sparkles, NotebookPen, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export type ExplainFn = (extensionId: string) => Promise<ExplainResult>;

/**
 * Why the host could not answer, in the reviewer's terms.
 *
 * Two different situations arrive as -32601: a host that knows the method but has no model, and a
 * host running an SDK from before the method existed. They need different fixes, so they get
 * different sentences; anything else is the host's own words.
 */
function unsupportedReason(message: string): string | null {
    if (/no model configured/i.test(message)) {
        return "This host has no model configured. Give it one — LLM_MODEL for a migrator host, or ANTHROPIC_API_KEY — and restart it.";
    }
    if (/unknown method|not found|not implemented/i.test(message)) {
        return "This host predates failure explanations. Update its extlens SDK and restart it.";
    }
    return null;
}

export function ExplainCard({
    extensionId,
    explain,
    onAppendNotes,
}: {
    extensionId: string;
    explain: ExplainFn;
    /** Put the explanation into the report's notes. Absent when the form cannot be edited here. */
    onAppendNotes?: (text: string) => void;
}) {
    const [state, setState] = useState<
        | { kind: "idle" }
        | { kind: "loading" }
        | { kind: "done"; result: ExplainResult }
        | { kind: "error"; message: string; reason: string | null }
    >({ kind: "idle" });
    // An explanation is about one extension's report; it must not linger onto the next row.
    useEffect(() => setState({ kind: "idle" }), [extensionId]);

    const run = () => {
        setState({ kind: "loading" });
        explain(extensionId)
            .then((result) => setState({ kind: "done", result }))
            .catch((e: Error) => setState({ kind: "error", message: e.message, reason: unsupportedReason(e.message) }));
    };

    return (
        <Card size="sm" className="bg-card/60">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Sparkles className="size-4 text-mauve" />
                    Why did it fail?
                </CardTitle>
                <CardDescription>
                    {state.kind === "done"
                        ? `Read by ${state.result.model} from the report, both manifests and the diff. A starting point, not a finding.`
                        : "Ask the host's model to read the report against the MV2→MV3 diff and name the likely cause."}
                </CardDescription>
                <CardAction>
                    {state.kind === "idle" || state.kind === "error" ? (
                        <Button size="sm" variant="outline" onClick={run} disabled={state.kind === "error" && state.reason !== null}>
                            <Sparkles className="size-4" />
                            Explain
                        </Button>
                    ) : state.kind === "loading" ? (
                        <Button size="sm" variant="outline" disabled>
                            <Spinner />
                            Reading…
                        </Button>
                    ) : (
                        <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={run} title="Ask again">
                                <RefreshCw className="size-4" />
                            </Button>
                            {onAppendNotes ? (
                                <Button size="sm" variant="outline" onClick={() => onAppendNotes(state.result.explanation)}>
                                    <NotebookPen className="size-4" />
                                    Add to notes
                                </Button>
                            ) : null}
                        </div>
                    )}
                </CardAction>
            </CardHeader>
            {state.kind === "done" ? (
                <CardContent>
                    <Markdownish text={state.result.explanation} />
                </CardContent>
            ) : state.kind === "error" ? (
                <CardContent>
                    <p className="flex items-start gap-2 text-sm text-peach">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                        {state.reason ?? state.message}
                    </p>
                </CardContent>
            ) : null}
        </Card>
    );
}

/**
 * Enough Markdown for a model's short answer — headings, lists, bold, code — without a parser in
 * the bundle. The prompt asks for three headed sections and under 300 words, so this is the whole
 * grammar it will ever see.
 */
function Markdownish({ text }: { text: string }) {
    const blocks = text.trim().split(/\n{2,}/);
    return (
        <div className="space-y-2 text-sm leading-relaxed">
            {blocks.map((block, i) => {
                const lines = block.split("\n");
                if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
                    return (
                        <ul key={i} className="list-disc space-y-1 pl-5">
                            {lines.map((l, j) => (
                                <li key={j}>
                                    <Inline text={l.replace(/^\s*([-*]|\d+\.)\s+/, "")} />
                                </li>
                            ))}
                        </ul>
                    );
                }
                const heading = /^#{1,6}\s+(.*)$/.exec(lines[0] ?? "");
                if (heading && lines.length === 1) {
                    return (
                        <h4 key={i} className="pt-1 font-medium">
                            <Inline text={heading[1]!} />
                        </h4>
                    );
                }
                return (
                    <p key={i}>
                        {lines.map((l, j) => (
                            <React.Fragment key={j}>
                                {j > 0 ? <br /> : null}
                                <Inline text={l} />
                            </React.Fragment>
                        ))}
                    </p>
                );
            })}
        </div>
    );
}

function Inline({ text }: { text: string }) {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
    return (
        <>
            {parts.map((part, i) => {
                if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
                if (part.startsWith("`") && part.endsWith("`")) {
                    return (
                        <code key={i} className="rounded bg-secondary px-1 font-mono text-xs">
                            {part.slice(1, -1)}
                        </code>
                    );
                }
                return <React.Fragment key={i}>{part}</React.Fragment>;
            })}
        </>
    );
}
