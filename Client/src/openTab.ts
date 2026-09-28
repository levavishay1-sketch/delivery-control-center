/** Opens a screen of the app in a new browser tab — for "open the task screen", so the place the person came from stays where it was. */
export const openInNewTab = (hash: string) => {
  window.open(`${location.pathname}${location.search}${hash}`, "_blank", "noopener");
};
