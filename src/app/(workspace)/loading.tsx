import { CanvasLogo } from "@/components/brand/canvas-logo";

/**
 * Workspace skeleton.
 *
 * A centred spinner would flash in the middle of an empty page and then jump as
 * the three panels appear. Holding the shell's shape instead means the layout
 * never moves once the website loads.
 */
export default function WorkspaceLoading() {
  return <div className="ws-shell ws-skeleton" aria-busy="true" aria-label="Opening this website">
    <div className="ws-menubar"><CanvasLogo variant="mark" size="lg" /><span className="ws-skeleton-bar" style={{ width: 240 }} /></div>
    <div className="ws-body">
      <div className="ws-pane ws-pane-l">
        <div className="ws-pane-hd"><h2>Website</h2></div>
        <div className="ws-skeleton-rows">{[68, 54, 76, 48, 62, 58].map((width, index) => <span className="ws-skeleton-bar" key={index} style={{ width: `${width}%` }} />)}</div>
      </div>
      <div className="ws-stage"><div className="ws-stage-bar" /><div className="ws-canvas"><div className="ws-device" /></div></div>
      <div className="ws-pane ws-pane-r">
        <div className="ws-pane-hd"><h2>Website Agent</h2></div>
        <div className="ws-skeleton-rows">{[80, 62].map((width, index) => <span className="ws-skeleton-bar" key={index} style={{ width: `${width}%` }} />)}</div>
      </div>
    </div>
    <div className="ws-statusbar"><span className="ws-sb-note">Opening this website…</span></div>
  </div>;
}
