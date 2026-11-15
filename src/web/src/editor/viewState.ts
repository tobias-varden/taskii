/** How the page is being looked at right now. Shared by the editors; never saved to the day. */
export const viewState = {
  /** Show only tasks with this tag. */
  filter: null as string | null,
  /** URL prefix for images stored in the data folder's assets. */
  assetBase: '',
  /**
   * Since when each note of the day on screen has read as it does, by `ageKey`. Null until
   * the shell has answered, and then the cards show no age.
   */
  noteAges: null as { date: string; today: string; since: Map<string, string> } | null,
};
