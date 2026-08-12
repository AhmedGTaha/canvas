export type BuilderViewState = { device: "desktop" | "tablet" | "mobile"; theme: "light" | "dark"; fullScreen: boolean };
export type BuilderViewAction = { type: "SET_DEVICE"; device: BuilderViewState["device"] } | { type: "SET_THEME"; theme: BuilderViewState["theme"] } | { type: "TOGGLE_FULL_SCREEN" } | { type: "EXIT_FULL_SCREEN" };
export const INITIAL_BUILDER_VIEW: BuilderViewState = { device: "desktop", theme: "light", fullScreen: false };

export function builderViewReducer(state: BuilderViewState, action: BuilderViewAction): BuilderViewState {
  if (action.type === "SET_DEVICE") return { ...state, device: action.device };
  if (action.type === "SET_THEME") return { ...state, theme: action.theme };
  if (action.type === "TOGGLE_FULL_SCREEN") return { ...state, fullScreen: !state.fullScreen };
  if (action.type === "EXIT_FULL_SCREEN") return { ...state, fullScreen: false };
  return state;
}
