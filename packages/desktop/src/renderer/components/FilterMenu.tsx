/**
 * "Filter by": the facets of the table, behind one button.
 *
 * A popover rather than more controls in the toolbar, because a filter is set rarely and read
 * constantly — the count on the trigger is what a reader needs at rest, and the checkboxes only
 * when they are changing them. The vocabulary is deliberately the table's own first column: the
 * four verdicts and "not yet reviewed", with the same glyph and colour, so picking a facet is
 * recognising something already seen in a row rather than translating it.
 *
 * Every change is a whole new `ListFilter` handed upward. The filter is a query parameter, not
 * local state: the host does the narrowing, so this component owns nothing but the gesture.
 */
import * as React from "react";
import type { ExtensionVerdict, ListFilter } from "@extlens/protocol";
import { VERDICT_LABELS, listFilterCount, listFilterIsEmpty } from "@extlens/protocol";
import { FileUp, Filter, PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { VERDICT_ICON, VERDICT_TONE } from "./shared";
import { cn } from "@/lib/utils";

const VERDICTS: ExtensionVerdict[] = ["working", "partially_working", "not_working", "not_testable"];

export const EMPTY_FILTER: ListFilter = {};

/**
 * Toggle one verdict, dropping the key entirely when nothing is left selected.
 *
 * An empty array and an absent one mean the same thing to the protocol, but only the absent one
 * makes `listFilterIsEmpty` true — and that is what decides whether the button reads as active.
 */
export function toggleVerdict(filter: ListFilter, verdict: ExtensionVerdict, on: boolean): ListFilter {
    const current = filter.verdicts ?? [];
    const next = on ? [...current, verdict] : current.filter((v) => v !== verdict);
    const { verdicts: _dropped, ...rest } = filter;
    return next.length > 0 ? { ...rest, verdicts: next } : rest;
}

/** Same rule for the flags: off is the absence of the key, not `false`. */
export function toggleUnreviewed(filter: ListFilter, on: boolean): ListFilter {
    const { unreviewed: _dropped, ...rest } = filter;
    return on ? { ...rest, unreviewed: true } : rest;
}

/**
 * The migration facet, as two checkboxes over one tri-state field.
 *
 * Ticking both is the same statement as ticking neither — "either is fine" — so it collapses back
 * to no constraint rather than to an impossible one. Radio buttons would say this more directly
 * but would need a third "any" row to be clearable, which is a control explaining the control.
 */
export function setMigrated(filter: ListFilter, value: boolean, on: boolean): ListFilter {
    const { migrated: _dropped, ...rest } = filter;
    if (!on) return filter.migrated === value ? rest : filter;
    return filter.migrated === !value ? rest : { ...rest, migrated: value };
}

export function FilterMenu({
    filter,
    onChange,
}: {
    filter: ListFilter;
    onChange: (filter: ListFilter) => void;
}) {
    const active = listFilterCount(filter);
    const verdicts = filter.verdicts ?? [];

    return (
        <Popover>
            {/* The trigger is the popover's own button wearing the button styles, rather than
                `asChild` around <Button>. Radix anchors the popover to the trigger through a ref,
                and <Button> is a plain function component — the ref lands nowhere, the anchor
                measures as nothing, and the popover opens 678px above the window where no one can
                see it. It looks exactly like a button that does nothing. */}
            <PopoverTrigger
                className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "h-8 gap-2",
                    active > 0 && "border-primary/40 text-foreground",
                )}
            >
                <Filter className="size-4" />
                Filter by
                {active > 0 ? (
                    <Badge variant="secondary" className="font-normal tabular-nums">
                        {active}
                    </Badge>
                ) : null}
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0">
                <Group label="Result">
                    {VERDICTS.map((verdict) => {
                        const Icon = VERDICT_ICON[verdict];
                        return (
                            <Row
                                key={verdict}
                                checked={verdicts.includes(verdict)}
                                onChange={(on) => onChange(toggleVerdict(filter, verdict, on))}
                                icon={<Icon className={cn("size-4", VERDICT_TONE[verdict])} />}
                                label={VERDICT_LABELS[verdict]}
                            />
                        );
                    })}
                    <Row
                        checked={filter.unreviewed === true}
                        onChange={(on) => onChange(toggleUnreviewed(filter, on))}
                        icon={<FileUp className="size-4 text-muted-foreground" />}
                        label="Not yet reviewed"
                    />
                </Group>

                <Separator />

                <Group label="Build">
                    <Row
                        checked={filter.migrated === true}
                        onChange={(on) => onChange(setMigrated(filter, true, on))}
                        icon={<PackageOpen className="size-4 text-muted-foreground" />}
                        label="Has an MV3 build"
                    />
                    <Row
                        checked={filter.migrated === false}
                        onChange={(on) => onChange(setMigrated(filter, false, on))}
                        icon={<PackageOpen className="size-4 text-muted-foreground" />}
                        label="Not migrated yet"
                    />
                </Group>

                <Separator />

                <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                        {/* Which facets are on is visible above; this says whether the table is narrowed
                            at all, which is the question a reader asks of a filter they did not just set. */}
                        {listFilterIsEmpty(filter) ? "Showing everything" : "Narrowed"}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        disabled={listFilterIsEmpty(filter)}
                        onClick={() => onChange(EMPTY_FILTER)}
                    >
                        Clear
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="p-1">
            <div className="px-2 pt-1.5 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {label}
            </div>
            {children}
        </div>
    );
}

/** A checkbox row: the whole row is the label, so the click target is the line and not the box. */
function Row({
    checked,
    onChange,
    icon,
    label,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
            <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
            {icon}
            <span className="truncate">{label}</span>
        </label>
    );
}
