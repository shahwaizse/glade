import React from "react";

interface RendererCrashBoundaryState {
  error: Error | null;
}

export class RendererCrashBoundary extends React.Component<
  React.PropsWithChildren,
  RendererCrashBoundaryState
> {
  state: RendererCrashBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): RendererCrashBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Glade renderer crashed", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="renderer-crash">
          <span className="eyebrow">Renderer Crash</span>
          <h1>Glade hit a rendering fault</h1>
          <p>{this.state.error.message}</p>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}
