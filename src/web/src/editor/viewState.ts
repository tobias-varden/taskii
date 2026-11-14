/** How the page is being looked at right now. Shared by the editors; never saved to the day. */
export const viewState = {
  /** Show only tasks with this tag. */
  filter: null as string | null,
  /** URL prefix for images stored in the data folder's assets. */
  assetBase: '',
};
