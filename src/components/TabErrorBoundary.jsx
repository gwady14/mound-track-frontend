import { Component } from 'react';

export default class TabErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) { console.error('Tab panel crash:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: 15, marginBottom: 8 }}>Something went wrong in this panel.</p>
          <button
            style={{ fontSize: 13, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => this.setState({ hasError: false })}
          >Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
