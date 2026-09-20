/**
 * How tall the log dock is allowed to be.
 *
 * Kept as a pure function because the drag that drives it is not testable without a layout engine,
 * and two attempts at delegating this to a panel library both failed in ways that only showed up on
 * screen. The arithmetic, at least, can be proven.
 */

/** Below this the log shows one line and a scrollbar, which is worse than being closed. */
export const MIN_DOCK_HEIGHT = 120;

/** The working area keeps at least this much, so the dock can never swallow the form. */
export const MIN_WORKING_HEIGHT = 200;

export function clampDockHeight(height: number, viewportHeight: number): number {
    const max = Math.max(MIN_DOCK_HEIGHT, viewportHeight - MIN_WORKING_HEIGHT);
    return Math.min(max, Math.max(MIN_DOCK_HEIGHT, Math.round(height)));
}

/**
 * Height after dragging the top edge by `deltaY` pixels.
 *
 * Dragging up must make the dock taller, so the delta is subtracted: the edge moving toward the top
 * of the screen is the dock gaining the space above it.
 */
export function heightAfterDrag(startHeight: number, deltaY: number, viewportHeight: number): number {
    return clampDockHeight(startHeight - deltaY, viewportHeight);
}
