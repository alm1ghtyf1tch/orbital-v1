"use client";

import { Component, type ReactNode } from "react";
import { Globe2, RotateCcw } from "lucide-react";

export class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean; key: number }> {
  state = { failed: false, key: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="globe-fallback">
      <Globe2 size={54} strokeWidth={1} />
      <h3>3D view unavailable</h3>
      <p>This browser could not start WebGL. Satellite calculations and pass forecasts are still available.</p>
      <button className="quiet-button" onClick={() => this.setState((state) => ({ failed: false, key: state.key + 1 }))}><RotateCcw size={14} /> Retry globe</button>
    </div>;
    return <div key={this.state.key} className="globe-boundary">{this.props.children}</div>;
  }
}
