import { Component, type ReactNode } from "react";

interface CheckpointErrorBoundaryProps {
  instanceId: string;
  label: string;
  required: boolean;
  onRetry: () => void;
  onSkip: () => void;
  children: ReactNode;
}

interface CheckpointErrorBoundaryState {
  hasError: boolean;
}

export default class CheckpointErrorBoundary extends Component<
  CheckpointErrorBoundaryProps,
  CheckpointErrorBoundaryState
> {
  state: CheckpointErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): CheckpointErrorBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: CheckpointErrorBoundaryProps): void {
    if (prevProps.instanceId !== this.props.instanceId && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="pi-inline-control-card pi-checkpoint-card">
        <div className="pi-selector-header">
          <span>{this.props.label}</span>
          <span className="pi-selector-meta">render error</span>
        </div>
        <div className="pi-error-inline">
          This control could not be rendered. You can retry the control rendering
          {this.props.required ? "." : " or skip it."}
        </div>
        <div className="pi-postgen-actions">
          <button type="button" className="pi-secondary-btn" onClick={this.props.onRetry}>
            Retry
          </button>
          {!this.props.required ? (
            <button type="button" className="pi-secondary-btn" onClick={this.props.onSkip}>
              Skip
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}
