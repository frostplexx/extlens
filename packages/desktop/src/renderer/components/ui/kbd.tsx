import { cn } from "cn"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

/**
 * A key hint sitting inside running text or a control: smaller and quieter than a Kbd, so it
 * annotates the thing it is next to rather than competing with it.
 */
function KbdHint({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <Kbd
      data-slot="kbd-hint"
      className={cn(
        "h-4 min-w-4 px-1 text-[10px] font-semibold uppercase tracking-wide",
        // Inherit the tone of a coloured parent (a primary button, a pressed status) instead of
        // painting a muted block on top of it.
        "in-[[data-slot=button]]:bg-current/15 in-[[data-slot=button]]:text-inherit",
        className
      )}
      {...props}
    />
  )
}

export { Kbd, KbdGroup, KbdHint }
