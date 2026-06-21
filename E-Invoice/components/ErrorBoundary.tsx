import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Optional fallback — override the default UI if a caller wants a specific look. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Optional scope label — shown in the default UI + logged for triage. */
  scope?: string;
}

interface State {
  error: Error | null;
}

/**
 * App-level Error Boundary. Keeps a rendering error in one route from blanking
 * the whole UI. Uses class component because React still requires that for
 * `componentDidCatch`.
 *
 * - In production the stack trace is hidden from the user, just shown in console.
 * - In dev (Vite adds import.meta.env.DEV) the raw message + stack is visible for faster debugging.
 * - Clicking "Try again" resets the boundary so navigation elsewhere works without a full reload.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Dev console always gets the full story.
    console.error(`[ErrorBoundary${this.props.scope ? ` · ${this.props.scope}` : ''}]`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(this.state.error, this.reset);
    }

    const isDev = (import.meta as any).env?.DEV === true;

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg border border-red-100 p-8 text-center space-y-4">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle size={28} className="text-red-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Something went wrong</h2>
            <p className="text-sm text-slate-500 mt-1">
              {this.props.scope ? `An error occurred in the ${this.props.scope} area.` : 'An unexpected error interrupted this view.'}
              {' '}The rest of the app is still available — you can try again or navigate elsewhere.
            </p>
          </div>
          {isDev && (
            <pre className="text-left text-xs bg-slate-50 border border-slate-100 rounded-lg p-3 overflow-auto max-h-40 text-slate-700">
              {this.state.error.message}
              {this.state.error.stack ? '\n\n' + this.state.error.stack : ''}
            </pre>
          )}
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={this.reset}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
            >
              <RefreshCw size={14} /> Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-white border border-gray-200 text-slate-700 rounded-lg text-sm font-semibold hover:bg-gray-50"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
