import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../ui/controls';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A crash should never leave a blank page. We show what happened, offer a reload,
 * and keep the message short — the console has the details.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console only. Nothing is reported anywhere.
    console.error('[chatbot] render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-5 text-center">
          <h1 className="font-display text-lg text-fg">Something broke on this screen</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Your conversations and keys are untouched — they live in local storage, not in this component tree.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
          <p className="mt-3 font-mono text-[11px] text-muted">{this.state.error.message.slice(0, 160)}</p>
        </div>
      </div>
    );
  }
}
