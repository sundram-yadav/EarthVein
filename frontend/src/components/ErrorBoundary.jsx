import React from 'react';

// Without this, one rendering error leaves the user on a blank page.
export default class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error('EarthVein UI error', error, info?.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-[100dvh] place-items-center p-6">
        <div className="glass edge max-w-md p-6 text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">The page hit an unexpected error. Your data is safe. Reload to continue.</p>
          <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
