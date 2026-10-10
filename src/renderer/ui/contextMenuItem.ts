export interface ContextMenuItem {
  id: string
  label: string
  /** Absent for a submenu parent, which opens rather than acts. */
  run?: () => void
  /** Opens a panel beside this item, one level deep, instead of running it. */
  submenu?: ContextMenuItem[]
  disabled?: boolean
  /** Starts a new visual group above this item, for separating unlike actions. */
  separator?: boolean
  /** Why the item is unavailable, shown on hover. A greyed-out item with no reason given reads as
   *  broken rather than as "not yet". */
  disabledReason?: string
  /** Makes the item a toggle, drawn with a tick while it is on. */
  checked?: boolean
}
