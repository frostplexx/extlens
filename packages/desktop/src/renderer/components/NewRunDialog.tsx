/**
 * Starting a new run: a model, a corpus, and a button.
 *
 * The model field is a text input with the provider's list behind it rather than a closed menu. The
 * list goes stale exactly when a newly published model is the thing worth trying, and it has been
 * seen to fail outright on a valid key — so it is offered as completion and never as a restriction.
 * A bare id is qualified by the host, so nobody has to type the provider prefix.
 *
 * Everything else has a default that is almost always right: the corpus the host was started with,
 * and the host's own thinking level and context window. The form asks for what varies between runs
 * and stays out of the way of what does not.
 *
 * Creating and starting are one gesture on purpose — an empty run is not a thing anyone wants — but
 * they are two calls, so a corpus that fails to start still leaves a run to look at.
 */
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import type { RunsState } from "../hooks/useRuns";
import { AlertTriangle, FolderOpen, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Mono } from "./shared";

export function NewRunDialog({
    open,
    onOpenChange,
    runs,
    /** Create the run, then start migrating the corpus. */
    onStart,
    /** Native directory picker, so a corpus path need not be typed. */
    onPickCorpus,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    runs: RunsState;
    onStart: (params: { model: string; corpus?: string; label?: string }) => Promise<void>;
    onPickCorpus: () => Promise<string | null>;
}) {
    const [model, setModel] = useState("");
    const [corpus, setCorpus] = useState("");
    const [label, setLabel] = useState("");

    // Reopening the dialog after a run started should not offer to repeat it verbatim; the corpus is
    // the exception, since it is the thing that stays the same across runs.
    useEffect(() => {
        if (open) {
            setModel("");
            setLabel("");
            setCorpus("");
        }
    }, [open]);

    const suggestions = useMemo(() => {
        const ids = (runs.models?.models ?? []).map((m) => m.id);
        const needle = model.trim().toLowerCase();
        const matches = needle === "" ? ids : ids.filter((id) => id.toLowerCase().includes(needle));
        return matches.slice(0, 8);
    }, [runs.models, model]);

    const effectiveCorpus = corpus.trim() || runs.defaultCorpus;
    const canStart = model.trim() !== "" && Boolean(effectiveCorpus) && !runs.busy;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>New run</DialogTitle>
                    <DialogDescription>
                        One model over one corpus. Its results stay separate from every other run.
                    </DialogDescription>
                </DialogHeader>

                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="run-model">Model</FieldLabel>
                        <Input
                            id="run-model"
                            value={model}
                            autoFocus
                            placeholder="deepseek-v4-flash-0731"
                            onChange={(e) => setModel(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && canStart) void onStart({ model, ...runParams(corpus, label) });
                            }}
                        />
                        <FieldDescription>
                            {runs.models?.error ? (
                                <span className="flex items-center gap-1.5 text-yellow">
                                    <AlertTriangle className="size-3.5 shrink-0" />
                                    Could not reach {runs.models.endpoint ?? "the provider"} for a model list — type a
                                    name.
                                </span>
                            ) : (
                                <>
                                    Sent as{" "}
                                    <Mono>
                                        {runs.models?.provider ?? "saia"}/{model.trim() || "…"}
                                    </Mono>
                                    . Any model the endpoint serves works, listed or not.
                                </>
                            )}
                        </FieldDescription>
                        {suggestions.length > 0 ? (
                            <div className="flex flex-wrap gap-1 pt-1">
                                {suggestions.map((id) => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setModel(id)}
                                        className="rounded-sm border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                                    >
                                        {id}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </Field>

                    <Field>
                        <FieldLabel htmlFor="run-corpus">Source directory</FieldLabel>
                        <div className="flex gap-2">
                            <Input
                                id="run-corpus"
                                value={corpus}
                                placeholder={runs.defaultCorpus ?? "a directory of MV2 extensions"}
                                onChange={(e) => setCorpus(e.target.value)}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label="Choose a directory"
                                onClick={() => void onPickCorpus().then((p) => p && setCorpus(p))}
                            >
                                <FolderOpen className="size-4" />
                            </Button>
                        </div>
                        <FieldDescription>
                            {runs.defaultCorpus
                                ? "Empty uses the corpus the host was started with."
                                : "This host has no default corpus, so a run must name one."}
                        </FieldDescription>
                    </Field>

                    <Field>
                        <FieldLabel htmlFor="run-label">Label (optional)</FieldLabel>
                        <Input
                            id="run-label"
                            value={label}
                            placeholder="after prompt change"
                            onChange={(e) => setLabel(e.target.value)}
                        />
                        <FieldDescription>
                            {/* Two runs of one model over one corpus are a normal thing to do, and the
                                model name cannot tell them apart afterwards. */}
                            What makes this run different from the last one with the same model.
                        </FieldDescription>
                    </Field>
                </FieldGroup>

                {runs.error ? <p className="text-sm text-destructive">{runs.error}</p> : null}

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={runs.busy}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!canStart}
                        onClick={() => void onStart({ model, ...runParams(corpus, label) })}
                    >
                        {runs.busy ? <Spinner className="size-4" /> : <Play className="size-4" />}
                        Create and start
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** Blank fields are absent, not empty strings: the host's defaults apply to what is not sent. */
function runParams(corpus: string, label: string): { corpus?: string; label?: string } {
    return {
        ...(corpus.trim() ? { corpus: corpus.trim() } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
    };
}
