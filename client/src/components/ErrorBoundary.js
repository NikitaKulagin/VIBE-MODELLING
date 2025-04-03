import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    // Обновить состояние, чтобы следующий рендер показал запасной UI.
    return { hasError: true, error: error };
  }

  componentDidCatch(error, errorInfo) {
    // Можно также сохранить информацию об ошибке в соответствующую службу журнала ошибок
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Можно отрендерить запасной UI произвольного вида
      return (
          <div style={{padding: '15px', color: 'red', border: '1px solid red', borderRadius: '4px', backgroundColor: '#fdd'}}>
              <h4>Decomposition Chart Error</h4>
              <p>Something went wrong while rendering the chart.</p>
              <details style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em' }}>
                  {this.state.error && this.state.error.toString()}
              </details>
          </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;